'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { HANDY_CLERK_COOKIE, serializeHandyClerk } from '@/lib/handy-clerk';
import { readHandyClerk } from '@/lib/handy-session';
import { validateVisitDraft, visitMemo, type VisitDraft } from '@/lib/handy-visit';
import { isSeatCourseItem } from '@/lib/menu-book';
import { addCustomPriceItem, addItem, sendItemsToKitchen, setGuestCount, setSeatTime } from '../pos/actions';
import { enqueueCancelSlipPrint } from '../pos/print-actions';
import { canHandyCancel, extendedStayMinutes, HANDY_EXTEND_OPTIONS, normalizeHandyMemo } from '@/lib/handy-cancel';
import { setOrderClerk } from '../pos/clerk-actions';
import { goToOrder, startWalkIn } from '../floor/actions';
import { MAX_LINE_QUANTITY } from '@/components/handy/logic';

/** ハンディで打てる金額の上限（レジの金額入力と同じ。app/app/pos/actions.ts） */
const OPEN_PRICE_MAX = 9_999_999;

/* ------------------------------------------------------------ 担当者 */

/** 担当者 Cookie の寿命。端末の登録（30日）より短くし、日をまたいだら選び直させる */
const CLERK_COOKIE_MAX_AGE_SEC = 60 * 60 * 20;

const clerkCookieOptions = {
  path: '/handy',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: CLERK_COOKIE_MAX_AGE_SEC,
};

/**
 * ログイン画面の「Login」: 担当者（POS担当者）をこの端末に覚える。
 * 担当者を選ばないとログインできない（2026-09-30 Ronnie「担当選択なしではログインできない」）。
 * 担当者は現在の店舗の有効な行だけ受け付ける（他店舗の担当者を指定できないようにする）。
 */
export async function loginHandyClerk(clerkId: string | null): Promise<void> {
  const ctx = await requirePermission('pos.order');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) throw new Error('アクセス可能な店舗がありません');
  if (!clerkId) throw new Error('担当者を選んでください');

  const supabase = await createClient();
  const { data: clerk } = await supabase
    .from('pos_clerks')
    .select('id, name')
    .eq('id', clerkId)
    .eq('store_id', store.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!clerk) throw new Error('この担当者は選べません。担当者を選び直してください');
  const value = serializeHandyClerk({ id: clerk.id, name: clerk.name });

  const jar = await cookies();
  jar.set(HANDY_CLERK_COOKIE, value, clerkCookieOptions);
  revalidatePath('/handy', 'layout');
}

/** ドロワーの「担当者を変更」: 担当者の選択を消してログイン画面に戻る（端末の登録はそのまま） */
export async function logoutHandyClerk(): Promise<void> {
  const jar = await cookies();
  jar.set(HANDY_CLERK_COOKIE, '', { ...clerkCookieOptions, maxAge: 0 });
  revalidatePath('/handy', 'layout');
  redirect('/handy');
}

/**
 * ハンディで作った伝票に担当者を入れる。失敗しても伝票は作れているので、注文は続けられるようにする
 * （担当者は会計時にレジでも変えられる）。
 */
async function assignHandyClerk(orderId: string): Promise<void> {
  const clerk = await readHandyClerk();
  if (!clerk?.id) return;
  try {
    await setOrderClerk(orderId, clerk.id);
  } catch (e) {
    console.error('[handy] clerk assign failed', e instanceof Error ? e.message : e);
  }
}

/* ------------------------------------------------------- 来店・伝票 */

/** 選んだプラン商品のうち、いちばん先に選んだコース（種別コース、または名前が コース／course。isSeatCourseItem）の id。無ければ null */
async function firstCoursePlanItem(planItemIds: string[]): Promise<string | null> {
  const ids = planItemIds.filter((v) => typeof v === 'string' && v);
  if (ids.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('menu_items').select('id, name, item_type').in('id', ids).neq('status', 'deleted');
  const courses = new Set(
    ((data ?? []) as { id: string; name: string; item_type: string | null }[])
      .filter((r) => isSeatCourseItem(r.item_type, r.name))
      .map((r) => r.id)
  );
  return ids.find((id) => courses.has(id)) ?? null;
}

/**
 * 「お客様情報」の確定: 空席の卓に来店を登録して伝票を作る（フロア画面のウォークインと同じ startWalkIn）。
 * 人数（男女）は合計を guest_count に、内訳・モード・利用シーン・時間制は伝票メモと予約（purpose / end_at）に残す。
 * コース／飲み放題のプラン商品を選んでいれば、その商品を伝票に1つ入れる（数量は注文画面で足せる）。
 */
export async function startHandyVisit(
  tableId: string,
  draft: VisitDraft
): Promise<{ orderId: string; planItemError: string | null }> {
  return startVisit(tableId, draft, { sendPlanNow: true });
}

/**
 * レジ（iPad）の「お客様情報」の確定。ハンディと同じだが、選んだプラン商品（飲み放題・コースなど）は
 * 伝票に「未送信」で入れるだけで、厨房へは送らない。レジの注文画面で Order をスライドしたときに送る
 * （2026-10-16 Ronnie「Order をスライドしていないのに注文が行った」SHUNKA 新宿 T401）。
 */
export async function startRegisterVisit(
  tableId: string,
  draft: VisitDraft
): Promise<{ orderId: string; planItemError: string | null }> {
  return startVisit(tableId, draft, { sendPlanNow: false });
}

async function startVisit(
  tableId: string,
  draft: VisitDraft,
  { sendPlanNow }: { sendPlanNow: boolean }
): Promise<{ orderId: string; planItemError: string | null }> {
  await requirePermission('pos.order');
  const problem = validateVisitDraft(draft);
  if (problem) throw new Error(problem);

  const guests = draft.male + draft.female;
  // 選んだプランのうちコースがあれば、席のコース（reservations.course_id）にも入れる。
  // これまでは伝票に商品を入れるだけだったので、注文画面の「お客様情報」のコースが「なし（アラカルト）」のままだった
  // （2026-10-06 FULL MOoN 御茶ノ水 宮崎さん「この画面でモードやプランを設定しても、次の画面で なし(アラカルト) になる」）。
  const seatCourseId = await firstCoursePlanItem(draft.planItemIds);
  const { orderId } = await startWalkIn(tableId, guests, {
    durationMinutes: draft.timed ? draft.duration : undefined,
    courseId: seatCourseId ?? undefined,
    purpose: draft.source || undefined,
    sourceLabel: draft.source || undefined,
    memo: visitMemo(draft),
    orderType: draft.plans.includes('course') ? 'course' : 'dine_in',
    startTime: draft.startTime ?? undefined,
  });
  await assignHandyClerk(orderId);

  // 選んだプラン商品（飲み放題B・食べ放題など。何個でも）を伝票に入れる
  let planItemError: string | null = null;
  const addedIds: string[] = [];
  for (const planItemId of draft.planItemIds) {
    try {
      // 価格・税率の検証は POS と同じ addItem に任せる
      const { id } = await addItem(orderId, planItemId, [], 1);
      if (id) addedIds.push(id);
    } catch (e) {
      // プラン商品が入らなくても来店登録は成立させる（注文画面で手動で入れられる）
      planItemError = e instanceof Error ? e.message : 'プラン商品を伝票に入れられませんでした';
    }
  }
  // ハンディで入れた品は厨房（ドリンク）へもすぐ送る（レジは Order のスライドで送る）
  if (sendPlanNow && addedIds.length > 0) {
    try {
      await sendItemsToKitchen(orderId, addedIds);
    } catch {
      // 送れなくても来店登録は成立させる（注文画面から送り直せる）
    }
  }

  revalidatePath('/handy');
  return { orderId, planItemError };
}

/**
 * 着席中の卓の伝票を開く（無ければ作る）。
 * 新しく作った伝票にだけハンディの担当者を入れる（既にある伝票の担当者は書き換えない）。
 */
export async function openHandyOrder(tableId: string): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('orders')
    .select('id, store_id')
    .eq('table_id', tableId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    await assertStoreAccess(ctx, existing.store_id);
    return { orderId: existing.id };
  }

  const { orderId } = await goToOrder(tableId);
  await assignHandyClerk(orderId);
  revalidatePath('/handy');
  return { orderId };
}

/**
 * お客様QRからの呼び出しを「対応済み」にする。
 * 自組織かつアクセス可能な店舗の、まだ未対応（open）の行だけを更新する
 * （他の端末が先に対応済みにしていた場合は黙って成功扱いにせず、その旨を返す）。
 */
export async function resolveServiceCall(callId: string): Promise<{ alreadyResolved: boolean }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: call } = await supabase
    .from('service_calls')
    .select('id, organization_id, store_id, table_id, kind, status')
    .eq('id', callId)
    .maybeSingle();
  if (!call) throw new Error('呼び出しが見つかりません');
  if (call.organization_id !== ctx.organizationId) throw new Error('この呼び出しは操作できません');
  await assertStoreAccess(ctx, call.store_id);

  if (call.status !== 'open') {
    revalidatePath('/handy');
    return { alreadyResolved: true };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('service_calls')
    .update({ status: 'done', resolved_at: now, resolved_by: ctx.userId })
    .eq('id', callId)
    // 他端末と同時に押された場合に二重更新しない
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(error.message);

  if (!updated || updated.length === 0) {
    revalidatePath('/handy');
    return { alreadyResolved: true };
  }

  await supabase.rpc('log_audit', {
    p_org: call.organization_id,
    p_store: call.store_id,
    p_action: 'service_call.resolve',
    p_target_table: 'service_calls',
    p_target_id: callId,
    p_before: { status: 'open', kind: call.kind },
    p_after: { status: 'done', resolved_at: now },
    p_note: call.kind === 'checkout' ? 'お会計希望に対応' : 'スタッフ呼び出しに対応',
  });

  revalidatePath('/handy');
  revalidatePath('/app/floor');
  return { alreadyResolved: false };
}

export interface HandyOrderLineInput {
  menuItemId: string;
  optionItemIds: string[];
  quantity: number;
  /** エラー文面に出す商品名（保存はサーバー側でDBの名前を使う） */
  name: string;
  /**
   * 「その他（価格入力）」の行（カテゴリの最後のボタン。2026-10-07 Ronnie）。あれば menuItemId はカートの仮の ID で、
   * 金額・内容はここから入れる（addCustomPriceItem）
   */
  custom?: { categoryId: string | null; price: number; memo: string | null };
  /** ハンディで打った金額（¥0 の商品＝延長・キャンセル料など。レジの「金額入力」と同じ。addItem が ¥0 の商品にだけ受ける） */
  openPrice?: number | null;
  /** 注文確認の ☰ で打ったメモ（フリーテキスト）。厨房伝票に「※…」で出る（2026-10-18 Ronnie） */
  memo?: string | null;
}

export interface HandySubmitResult {
  /** 実際に伝票へ追加できた点数 */
  sentQuantity: number;
  /** 送信できずカートに残す行（失敗時は途中の行も残る） */
  remaining: HandyOrderLineInput[];
  /** 失敗した理由。null なら全件送信できた */
  message: string | null;
}

/**
 * ハンディのカートを伝票へ送信し、そのまま厨房（キッチン・ドリンクのプリンター／KDS）へ送る。
 * 既存のPOSサーバーアクション（addItem）をそのまま呼ぶ（価格・税率・選択肢の検証はPOS側と同一）。
 * addItem はレジと同じく「未送信」で明細を入れるので、全行を入れ終わったら追加した明細だけを
 * sendItemsToKitchen で同じ時刻に送信済みにする（これをしないと厨房伝票が出ない。2026-09-21 店舗報告）。
 *
 * 途中で失敗したら、そこで中断して「送信できた点数」と「カートに残す行」を返す。
 * それまでに入った明細は伝票にあるので、厨房へも送っておく。
 * 呼び出し側は残った行をカートに戻すこと（成功したように見せない）。
 */
export async function submitHandyOrder(
  orderId: string,
  lines: HandyOrderLineInput[]
): Promise<HandySubmitResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  if (lines.length === 0) throw new Error('注文する商品がありません');
  if (lines.length > 50) throw new Error('一度に送信できる商品は50種類までです');
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      throw new Error(`数量は1〜${MAX_LINE_QUANTITY}で指定してください`);
    }
    if (line.openPrice != null && (!Number.isInteger(line.openPrice) || line.openPrice < 0 || line.openPrice > OPEN_PRICE_MAX)) {
      throw new Error(`金額は0〜${OPEN_PRICE_MAX.toLocaleString('ja-JP')}円の整数で入力してください`);
    }
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) throw new Error('注文が見つかりません');
  await assertStoreAccess(ctx, order.store_id);
  if (order.status !== 'open') throw new Error('この注文は既に会計済み・取消済みです');

  // 1行＝1回の追加（数量ぶんまとめて1明細にする）。1個ずつ呼ぶと数量×往復になり、
  // 伝票と厨房伝票にも同じ商品が数量ぶん別行で並んでしまう
  let sentQuantity = 0;
  const addedIds: string[] = [];

  /** 追加できた明細を厨房へ送る。失敗したら画面に出す文言を返す（明細は伝票に入っている） */
  const sendAddedToKitchen = async (): Promise<string | null> => {
    if (addedIds.length === 0) return null;
    try {
      await sendItemsToKitchen(orderId, addedIds);
      return null;
    } catch (e) {
      console.error('[handy] kitchen send failed', orderId, e instanceof Error ? e.message : e);
      return '伝票には入りましたが、厨房への送信に失敗しました。レジの「厨房へオーダー」で送ってください';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const { id } = line.custom
        ? await addCustomPriceItem(orderId, {
            categoryId: line.custom.categoryId,
            price: line.custom.price,
            quantity: line.quantity,
            memo: line.custom.memo,
          })
        : await addItem(orderId, line.menuItemId, line.optionItemIds, line.quantity, line.openPrice ?? null);
      const memo = line.custom ? null : normalizeHandyMemo(line.memo);
      if (id && memo) {
        // 厨房へ送る前にメモを入れる（送ったあとだと厨房伝票にメモが出ない）
        const { error: memoError } = await supabase.from('order_items').update({ memo }).eq('id', id);
        if (memoError) console.error('[handy] memo update failed', id, memoError.message);
      }
      if (id) addedIds.push(id);
      sentQuantity += line.quantity;
    } catch (e) {
      const reason = e instanceof Error ? e.message : '送信に失敗しました';
      const sendProblem = await sendAddedToKitchen();
      revalidatePath('/handy');
      return {
        sentQuantity,
        remaining: lines.slice(i),
        message: `「${line.name}」で中断しました：${reason}${sendProblem ? `（${sendProblem}）` : ''}`,
      };
    }
  }

  const sendProblem = await sendAddedToKitchen();
  revalidatePath('/handy');
  return { sentQuantity, remaining: [], message: sendProblem };
}

/* ------------------------------------------------- 卓の画面：人数・時間・取消 */

async function loadHandyOpenOrder(orderId: string) {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, organization_id, store_id, status, opened_at, reservation_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) throw new Error('伝票が見つかりません');
  if (order.organization_id !== ctx.organizationId) throw new Error('この伝票は操作できません');
  await assertStoreAccess(ctx, order.store_id);
  if (order.status !== 'open') throw new Error('この伝票は既に会計済み・取消済みです');
  return { ctx, supabase, order };
}

/** 人数変更（レジの「人数」と同じ。予約の人数もそろえる） */
export async function setHandyGuestCount(orderId: string, guestCount: number): Promise<void> {
  await setGuestCount(orderId, guestCount);
  revalidatePath('/handy', 'layout');
}

/**
 * 時間延長（2026-10-18 Ronnie）。席の終了予定を今の時間＋延長分にする（開始時刻・コースはそのまま）。
 * 延長料金はメニューの「延長」（金額を打つ商品）で入れる。ここは時間（フロア・ハンディの残り時間・L.O.）だけ
 */
export async function extendHandyStay(orderId: string, minutes: number): Promise<{ endsAt: string }> {
  if (!(HANDY_EXTEND_OPTIONS as readonly number[]).includes(minutes)) throw new Error('延長は30〜120分で選んでください');
  const { supabase, order } = await loadHandyOpenOrder(orderId);
  const openedMs = new Date(order.opened_at as string).getTime();
  let currentMinutes: number | null = null;
  let courseId: string | null = null;
  if (order.reservation_id) {
    const { data: rsv } = await supabase
      .from('reservations')
      .select('end_at, course_id')
      .eq('id', order.reservation_id as string)
      .maybeSingle();
    const endMs = rsv?.end_at ? new Date(rsv.end_at as string).getTime() : NaN;
    if (Number.isFinite(endMs) && endMs > openedMs) currentMinutes = Math.round((endMs - openedMs) / 60_000);
    courseId = (rsv?.course_id as string | null) ?? null;
  }
  if (currentMinutes === null) {
    const { data: settings } = await supabase
      .from('store_settings')
      .select('default_stay_minutes')
      .eq('store_id', order.store_id as string)
      .maybeSingle();
    currentMinutes = (settings?.default_stay_minutes as number | null) ?? 120;
  }
  const next = extendedStayMinutes(currentMinutes, minutes);
  await setSeatTime(orderId, { startTime: null, durationMinutes: next, courseId });
  revalidatePath('/handy', 'layout');
  return { endsAt: new Date(openedMs + next * 60_000).toISOString() };
}

/**
 * 送った品を1つ取り消す（ハンディの −。送ってから5分以内だけ。2026-10-18 Ronnie）。
 * 2つ以上なら1つ減らし、1つなら品目取消。厨房には差分（マイナス）が出て、送信済みの品はレジにも取消の紙を出す。
 * 5分を過ぎたもの・伝票ごとの取消はレジで（店長以上の承認）。
 */
export async function cancelRecentHandyItem(
  orderId: string,
  orderItemId: string
): Promise<{ quantity: number }> {
  const { ctx, supabase, order } = await loadHandyOpenOrder(orderId);
  const { data: line } = await supabase
    .from('order_items')
    .select('id, order_id, name, quantity, unit_price, status, created_at, kitchen_sent_at, modifiers, memo')
    .eq('id', orderItemId)
    .maybeSingle();
  if (!line || line.order_id !== orderId) throw new Error('品目が見つかりません');
  if (line.status !== 'active') throw new Error('この品目は既に取消済みです');
  const orderedAt = (line.kitchen_sent_at as string | null) ?? (line.created_at as string);
  if (!canHandyCancel(new Date(orderedAt).getTime(), Date.now())) {
    throw new Error('送ってから5分を過ぎたので、ハンディでは取り消せません。レジで取消してください');
  }

  const qty = Number(line.quantity);
  if (qty > 1) {
    const next = qty - 1;
    const { error } = await supabase
      .from('order_items')
      .update({ quantity: next, line_total: Number(line.unit_price) * next, updated_by: ctx.userId })
      .eq('id', orderItemId)
      .eq('status', 'active');
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('order_items')
      .update({
        status: 'cancelled',
        cancel_reason: 'ハンディで取消（5分以内）',
        cancelled_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', orderItemId)
      .eq('status', 'active');
    if (error) throw new Error(error.message);
  }

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order_item.handy_cancel',
    p_target_table: 'order_items',
    p_target_id: orderItemId,
    p_before: { status: 'active', name: line.name, quantity: qty },
    p_after: qty > 1 ? { quantity: qty - 1 } : { status: 'cancelled' },
    p_note: 'ハンディで取消（送ってから5分以内）',
  });
  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });

  // 送信済みの品は、レジにも「取消」の紙を出す（レジの品目取消と同じ。厨房ぶんはマイナス差分で出る）
  if (line.kitchen_sent_at) {
    try {
      const modifiers = ((line.modifiers ?? []) as { name?: string }[])
        .map((m) => m?.name)
        .filter((n): n is string => !!n);
      await enqueueCancelSlipPrint(orderId, [
        { name: line.name as string, quantity: 1, modifiers, memo: (line.memo as string | null) ?? null },
      ]);
    } catch (e) {
      console.error('[handy.cancelRecentHandyItem] cancel slip print failed:', e);
    }
  }

  revalidatePath('/handy', 'layout');
  revalidatePath('/app/pos');
  return { quantity: qty > 1 ? qty - 1 : 0 };
}

