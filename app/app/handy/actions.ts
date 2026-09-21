'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { HANDY_CLERK_COOKIE, NO_CLERK_NAME, serializeHandyClerk } from '@/lib/handy-clerk';
import { readHandyClerk } from '@/lib/handy-session';
import { validateVisitDraft, visitMemo, type VisitDraft } from '@/lib/handy-visit';
import { addItem } from '../pos/actions';
import { setOrderClerk } from '../pos/clerk-actions';
import { goToOrder, startWalkIn } from '../floor/actions';
import { MAX_LINE_QUANTITY } from '@/components/handy/logic';

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
 * clerkId が null なら「担当者なし」で使う（担当者を登録していない店）。
 * 担当者は現在の店舗の有効な行だけ受け付ける（他店舗の担当者を指定できないようにする）。
 */
export async function loginHandyClerk(clerkId: string | null): Promise<void> {
  const ctx = await requirePermission('pos.order');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) throw new Error('アクセス可能な店舗がありません');

  let value = serializeHandyClerk({ id: null, name: NO_CLERK_NAME });
  if (clerkId) {
    const supabase = await createClient();
    const { data: clerk } = await supabase
      .from('pos_clerks')
      .select('id, name')
      .eq('id', clerkId)
      .eq('store_id', store.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!clerk) throw new Error('この担当者は選べません。担当者を選び直してください');
    value = serializeHandyClerk({ id: clerk.id, name: clerk.name });
  }

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

/**
 * 「お客様情報」の確定: 空席の卓に来店を登録して伝票を作る（フロア画面のウォークインと同じ startWalkIn）。
 * 人数（男女）は合計を guest_count に、内訳・モード・利用シーン・時間制は伝票メモと予約（purpose / end_at）に残す。
 * コース／飲み放題のプラン商品を選んでいれば、その商品を伝票に1つ入れる（数量は注文画面で足せる）。
 */
export async function startHandyVisit(
  tableId: string,
  draft: VisitDraft
): Promise<{ orderId: string; planItemError: string | null }> {
  await requirePermission('pos.order');
  const problem = validateVisitDraft(draft);
  if (problem) throw new Error(problem);

  const guests = draft.male + draft.female;
  const { orderId } = await startWalkIn(tableId, guests, {
    durationMinutes: draft.timed ? draft.duration : undefined,
    purpose: draft.scene || undefined,
    memo: visitMemo(draft),
    orderType: draft.plan === 'course' ? 'course' : 'dine_in',
  });
  await assignHandyClerk(orderId);

  let planItemError: string | null = null;
  if (draft.planItemId) {
    try {
      // 価格・税率の検証は POS と同じ addItem に任せる
      await addItem(orderId, draft.planItemId, [], 1);
    } catch (e) {
      // プラン商品が入らなくても来店登録は成立させる（注文画面で手動で入れられる）
      planItemError = e instanceof Error ? e.message : 'プラン商品を伝票に入れられませんでした';
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
 * ハンディのカートを伝票へ送信する。
 * 既存のPOSサーバーアクション（addItem）をそのまま呼ぶ（価格・税率・選択肢の検証はPOS側と同一）。
 * addItem は1回で1点を追加するため、数量ぶん繰り返す（POSで商品を複数回タップした場合と同じ結果）。
 *
 * 途中で失敗したら、そこで中断して「送信できた点数」と「カートに残す行」を返す。
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      await addItem(orderId, line.menuItemId, line.optionItemIds, line.quantity);
      sentQuantity += line.quantity;
    } catch (e) {
      const reason = e instanceof Error ? e.message : '送信に失敗しました';
      revalidatePath('/handy');
      return {
        sentQuantity,
        remaining: lines.slice(i),
        message: `「${line.name}」で中断しました：${reason}`,
      };
    }
  }

  revalidatePath('/handy');
  return { sentQuantity, remaining: [], message: null };
}
