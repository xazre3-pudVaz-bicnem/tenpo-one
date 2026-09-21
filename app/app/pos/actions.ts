'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumnError } from '@/lib/schema-compat';
import { applicableTaxRate } from '@/lib/tax';
import { validateCoupon, COUPON_REJECT_LABELS, type CouponLike } from '@/lib/coupons';
import { resolveOptionSelection } from '@/lib/menu-options';

const COUPON_PREFIX = 'クーポン: ';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** JSTの'HH:MM'（クーポンの時間帯判定用） */
function jstTimeHHMM(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

async function loadOpenOrder(
  supabase: SupabaseServerClient,
  ctx: { isHq: boolean; stores: { id: string }[] },
  orderId: string
) {
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error('注文が見つかりません');
  await assertStoreAccess(ctx, order.store_id);
  if (order.status !== 'open') throw new Error('この注文は既に会計済み・取消済みです');
  return order;
}

/** テイクアウト注文を新規作成する */
export async function startTakeout(): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) throw new Error('アクセス可能な店舗がありません');

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      organization_id: ctx.organizationId,
      store_id: store.id,
      order_type: 'takeout',
      status: 'open',
      guest_count: 1,
      staff_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(error?.message ?? '注文の作成に失敗しました');

  revalidatePath('/app/pos');
  return { orderId: order.id as string };
}

/** 商品をタップして伝票に1品追加する（価格・税率をスナップショット） */
/**
 * 選択された選択肢を検証し、モディファイア表記と追加料金の合計を返す。
 * - 選択肢は「対象商品に紐づくグループ」に属するものだけ受け付ける（他商品・他店舗の混入を防ぐ）
 * - 必須グループは min_select 以上、各グループは max_select 以下であることを検証する
 */
async function resolveOptions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string,
  menuItemId: string,
  optionItemIds: string[]
): Promise<{ modifiers: { name: string; name_en?: string; price: number }[]; extraPrice: number }> {
  const { data: links } = await supabase
    .from('menu_item_option_groups')
    .select('group_id, sort_order, menu_option_groups(id, name, is_required, min_select, max_select, status)')
    .eq('menu_item_id', menuItemId)
    .eq('store_id', storeId)
    .order('sort_order');

  const groups = (links ?? [])
    .map((l: { menu_option_groups: unknown }) => l.menu_option_groups as {
      id: string; name: string; is_required: boolean; min_select: number; max_select: number; status: string;
    } | null)
    .filter((g: { status: string } | null): g is { id: string; name: string; is_required: boolean; min_select: number; max_select: number; status: string } => !!g && g.status === 'active');

  // グループが無い商品に選択肢を渡された場合は不正
  if (groups.length === 0) {
    if (optionItemIds.length > 0) throw new Error('この商品に選択肢は設定されていません');
    return { modifiers: [], extraPrice: 0 };
  }

  const uniqueIds = Array.from(new Set(optionItemIds));
  const { data: chosen } = uniqueIds.length
    ? await supabase
        .from('menu_option_items')
        .select('id, name, name_en, price, group_id, status')
        .in('id', uniqueIds)
        .eq('store_id', storeId)
        .eq('status', 'active')
    : { data: [] };

  const selected = (chosen ?? []) as {
    id: string;
    name: string;
    name_en: string | null;
    price: number;
    group_id: string;
  }[];
  // 指定IDのうち1件でも取得できなければ、他店舗・無効な選択肢が混ざっている
  if (selected.length !== uniqueIds.length) {
    throw new Error('選択された選択肢が正しくありません');
  }

  return resolveOptionSelection(
    groups.map((g: { id: string; name: string; is_required: boolean; min_select: number; max_select: number }) => ({
      id: g.id,
      name: g.name,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
    })),
    selected.map((o) => ({ id: o.id, name: o.name, nameEn: o.name_en, price: o.price, groupId: o.group_id }))
  );
}

/**
 * 注文に商品を追加する。
 * optionItemIds を渡すと選択肢（トッピング等）を適用し、追加料金を単価に加算して
 * order_items.modifiers に [{name, name_en?, price}] として記録する
 * （レシートには日本語、厨房伝票には英語が出る）。
 * 必須・最小/最大の選択数はサーバー側で検証する（クライアントの表示崩れや改ざんに依存しない）。
 */
/**
 * 明細を追加する。quantity を指定すると1行にまとめて入れる
 * （ハンディのカート送信用。POSのタップは従来どおり1個ずつ）。
 */
export async function addItem(
  orderId: string,
  menuItemId: string,
  optionItemIds: string[] = [],
  quantity = 1
): Promise<{ id: string | null }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new Error('数量は1〜99で指定してください');
  }
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: item } = await supabase
    .from('menu_items')
    .select('id, name, price, takeout_price, item_type, is_sold_out, status, tax_rates(rate, is_inclusive)')
    .eq('id', menuItemId)
    .single();
  if (!item) throw new Error('商品が見つかりません');
  if (item.status !== 'active') throw new Error('この商品は現在販売していません');
  if (item.is_sold_out) throw new Error('この商品は売り切れです');

  const taxRateRow = item.tax_rates as unknown as { rate: number; is_inclusive: boolean } | null;
  // pre_order（事前注文）もテイクアウト同様の受け渡し形態のため、価格・軽減税率判定に含める
  // （lib/tax.ts の applicableTaxRate は pre_order を takeout/delivery と同じ扱いにしている。ここが漏れていると
  //  事前注文の商品が店内飲食価格・標準税率10%で計算されてしまう）
  const isTakeoutLike =
    order.order_type === 'takeout' || order.order_type === 'delivery' || order.order_type === 'pre_order';
  const unitPrice = isTakeoutLike ? (item.takeout_price ?? item.price) : item.price;
  const taxRate = isTakeoutLike
    ? applicableTaxRate(order.order_type as 'takeout' | 'delivery' | 'pre_order', item.item_type === 'drink')
    : (taxRateRow?.rate ?? 10);
  const taxIncluded = taxRateRow?.is_inclusive ?? true;

  // 選択肢グループの検証と追加料金の算出
  const { modifiers, extraPrice } = await resolveOptions(supabase, order.store_id, item.id, optionItemIds);
  const finalUnitPrice = unitPrice + extraPrice;

  const row = {
    organization_id: order.organization_id,
    store_id: order.store_id,
    order_id: orderId,
    menu_item_id: item.id,
    name: item.name,
    unit_price: finalUnitPrice,
    quantity,
    tax_rate: taxRate,
    tax_included: taxIncluded,
    line_total: finalUnitPrice * quantity,
    // modifiers は NOT NULL（既定 '[]'）。選択肢なしでも null ではなく空配列を入れる
    modifiers,
    staff_id: ctx.userId,
    status: 'active',
    created_by: ctx.userId,
  };
  // レジで貯めている途中（未送信）。「厨房へオーダー」を押すまで厨房伝票・KDS には出さない。
  // タップした瞬間に厨房へ流れると押し間違いがそのまま厨房に届くため（店舗要望）。
  // ハンディは送信の最後に sendItemsToKitchen で追加した明細だけを送る。
  let { data: inserted, error } = await supabase
    .from('order_items')
    .insert({ ...row, kitchen_sent_at: null })
    .select('id')
    .single();
  if (error && isMissingColumnError(error.message, 'kitchen_sent_at')) {
    // migration 00063 未適用（列が無い）。従来どおり即時に厨房へ流す挙動で登録だけは通す
    ({ data: inserted, error } = await supabase.from('order_items').insert(row).select('id').single());
  }
  if (error) throw new Error(error.message);

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  revalidatePath(`/app/pos`);
  return { id: (inserted?.id as string | undefined) ?? null };
}

/**
 * 指定した明細だけを厨房へ送る（ハンディの「注文を送信」・お客様情報のプラン商品用）。
 * ハンディは1回の送信で複数の明細を追加するため、全部入れ終わってから同じ時刻でまとめて送信済みにする
 * （1明細ずつ送ると、プリンタのポーリングの境目で1回の注文が2回に分かれて出る）。
 * 同じ伝票でレジが貯めている途中の明細（未送信）は送らない。
 * DB に kitchen_sent_at が無い（migration 未適用）ときは、追加した時点で送信済みなので何もしない。
 */
export async function sendItemsToKitchen(orderId: string, itemIds: string[]): Promise<SendOrderResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  await loadOpenOrder(supabase, ctx, orderId);
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return { sent: 0 };

  const { data, error } = await supabase
    .from('order_items')
    .update({ kitchen_sent_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('order_id', orderId)
    .in('id', ids)
    .is('kitchen_sent_at', null)
    .select('id');
  if (error) {
    if (isMissingColumnError(error.message, 'kitchen_sent_at')) return { sent: ids.length };
    throw new Error(error.message);
  }
  revalidatePath(`/app/pos`);
  revalidatePath(`/app/kitchen`);
  return { sent: (data ?? []).length };
}

export interface SendOrderResult {
  /** 今回厨房へ送った品目数（行数） */
  sent: number;
}

/**
 * 伝票の未送信品目をまとめて厨房へ送る（kitchen_sent_at を立てる）。
 * 厨房プリンターは claim_kitchen_items のポーリングで、送信済みの明細だけを伝票にする。
 * KDS も送信済みだけを表示する。送るものが無ければ sent:0（エラーにはしない）。
 */
export async function sendOrderToKitchen(orderId: string): Promise<SendOrderResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  await loadOpenOrder(supabase, ctx, orderId);
  const sent = await markUnsentItemsSent(supabase, orderId, ctx.userId);
  if (sent == null) {
    throw new Error('厨房へのまとめ送信はまだ有効になっていません（DB更新待ち）。品目は追加時に厨房へ送られています');
  }
  revalidatePath(`/app/pos`);
  revalidatePath(`/app/kitchen`);
  return { sent };
}

/**
 * 未送信（kitchen_sent_at null）の有効明細を送信済みにする。戻り値は更新行数。
 * migration 00063 未適用（列が無い）のときは null（＝そもそも未送信という状態が無い）。
 */
async function markUnsentItemsSent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from('order_items')
    .update({ kitchen_sent_at: new Date().toISOString(), updated_by: userId })
    .eq('order_id', orderId)
    .eq('status', 'active')
    .is('kitchen_sent_at', null)
    .select('id');
  if (error) {
    if (isMissingColumnError(error.message, 'kitchen_sent_at')) return null;
    throw new Error(error.message);
  }
  return (data ?? []).length;
}

/** 数量を+/-する（1未満にはしない。取消は cancelItem を使う） */
export async function updateQty(orderId: string, orderItemId: string, delta: number) {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: line } = await supabase
    .from('order_items')
    .select('id, order_id, unit_price, quantity, status')
    .eq('id', orderItemId)
    .single();
  if (!line || line.order_id !== orderId) throw new Error('品目が見つかりません');
  if (line.status !== 'active') throw new Error('この品目は既に取消済みです');

  const nextQty = Math.max(1, line.quantity + delta);
  const { error } = await supabase
    .from('order_items')
    .update({ quantity: nextQty, line_total: line.unit_price * nextQty, updated_by: ctx.userId })
    .eq('id', orderItemId);
  if (error) throw new Error(error.message);

  await supabase.rpc('recalc_order_totals', { p_order_id: order.id });
  revalidatePath(`/app/pos`);
}

/** 品目取消（理由必須・監査ログ） */
export async function cancelItem(orderId: string, orderItemId: string, reason: string) {
  const ctx = await requirePermission('pos.order');
  if (!reason.trim()) throw new Error('取消理由を入力してください');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: line } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', orderItemId)
    .single();
  if (!line || line.order_id !== orderId) throw new Error('品目が見つかりません');
  if (line.status !== 'active') throw new Error('この品目は既に取消済みです');

  const { error } = await supabase
    .from('order_items')
    .update({
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq('id', orderItemId);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order_item.cancel',
    p_target_table: 'order_items',
    p_target_id: orderItemId,
    p_before: { status: line.status, name: line.name, quantity: line.quantity },
    p_after: { status: 'cancelled' },
    p_note: reason,
  });

  await supabase.rpc('recalc_order_totals', { p_order_id: order.id });
  revalidatePath(`/app/pos`);
}

/** 値引きを設定する（権限保持者のみ・監査ログ） */
export async function setDiscount(orderId: string, discountTotal: number, reason: string) {
  const ctx = await requirePermission('pos.discount');
  if (discountTotal < 0) throw new Error('値引き額が不正です');
  if (discountTotal > 0 && !reason.trim()) throw new Error('値引き理由を入力してください');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  // 手動値引きはクーポン枠と排他（discount_total/reasonを共有するため、手動設定時はクーポン紐付けを外す）
  const { error } = await supabase
    .from('orders')
    .update({
      discount_total: discountTotal,
      discount_reason: reason || null,
      coupon_id: null,
      coupon_code: null,
      updated_by: ctx.userId,
    })
    .eq('id', orderId);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.discount',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { discount_total: order.discount_total },
    p_after: { discount_total: discountTotal },
    p_note: reason || null,
  });

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  revalidatePath(`/app/pos`);
}

export interface CheckoutPayment {
  method: 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account' | 'points' | 'external' | 'other';
  amount: number;
  tendered?: number;
}

export interface CheckoutOutcome {
  ok: boolean;
  /** true の場合は二重会計等で既に確定済み。エラーではなく案内として扱う */
  alreadyPaid?: boolean;
  /** true の場合はレジ未開局のため会計を受け付けなかった（先にレジを開局する） */
  registerClosed?: boolean;
  warning?: string | null;
  /** finalize_order が返す今回付与ポイント数（0以下は付与なし） */
  pointsEarned?: number;
}

/**
 * 会計確定。
 * レジ未開局の場合は会計を受け付けない（registerClosed:true を返す）。毎日の開局時に釣銭準備金を数え、
 * 締め時に精算するルールのため、レジを開けずに会計すると現金がレジ台帳に載らず締めの数字が合わなくなる。
 * finalize_order は status<>'open' をDB層で拒否する（二重会計防止）。
 * 既に会計済みだった場合はエラーにせず alreadyPaid:true を返し、呼び出し側でレシートへ誘導する。
 */
export async function checkout(orderId: string, payments: CheckoutPayment[]): Promise<CheckoutOutcome> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error('注文が見つかりません');
  await assertStoreAccess(ctx, order.store_id);

  if (order.status !== 'open') {
    return { ok: false, alreadyPaid: true };
  }

  const { data: session } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('store_id', order.store_id)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    return { ok: false, registerClosed: true };
  }

  // 未送信のまま会計する品目（先払い・テイクアウトなど）は、会計と同時に厨房へ送る。
  // 送らずに会計すると、お金だけ受け取って厨房が知らない状態になる。
  await markUnsentItemsSent(supabase, orderId, ctx.userId);

  const { data, error } = await supabase.rpc('finalize_order', {
    p_order_id: orderId,
    p_payments: payments,
    p_register_session_id: session.id,
  });

  if (error) {
    if (error.message?.includes('ORDER_NOT_OPEN')) {
      return { ok: false, alreadyPaid: true };
    }
    if (error.message?.includes('PAYMENT_MISMATCH')) {
      throw new Error('お預かり金額の合計が会計金額と一致しません。金額をご確認ください');
    }
    if (error.message?.includes('INSUFFICIENT_POINTS')) {
      throw new Error('ポイント残高が不足しています');
    }
    if (error.message?.includes('POINTS_REQUIRE_CUSTOMER') || error.message?.includes('LOYALTY_DISABLED')) {
      throw new Error('ポイント払いには顧客紐付け・会員機能の有効化が必要です');
    }
    console.error('[pos.checkout] finalize_order failed:', error);
    throw new Error('会計の確定に失敗しました。通信状態を確認して再度お試しください');
  }

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  revalidatePath('/app/floor');

  const result = data as { points_earned?: number } | null;
  return { ok: true, warning: null, pointsEarned: result?.points_earned ?? 0 };
}

export interface SplitMove {
  orderItemId: string;
  /** 移動する数量（元品目の数量以下）。全量を指定すると品目ごと移動する */
  quantity: number;
}

/**
 * 伝票分割: 選択した品目（数量の一部指定可）を新しい注文へ移動する。
 * 個別会計はこの機能で実現する（分割後、両伝票をそれぞれ会計できる）。
 */
export async function splitOrder(
  orderId: string,
  moves: SplitMove[]
): Promise<{ newOrderId: string }> {
  const ctx = await requirePermission('pos.checkout');
  if (!moves || moves.length === 0) throw new Error('移動する品目を選択してください');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  // 同一 orderItemId が複数回渡された場合（多重送信やクライアントの不具合）に備え、
  // 品目ごとの移動数量を合算してから保有数量を検証する。合算せず個別に検証すると、
  // 「5個中3個」の指定を2回渡すだけで合計6個（保有数超過）が素通りし、
  // 新伝票側に品目が二重生成されてしまう（実在しない在庫・売上が生まれるバグ）。
  const movesByItem = new Map<string, number>();
  for (const m of moves) {
    if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
      throw new Error('移動数量が不正です');
    }
    movesByItem.set(m.orderItemId, (movesByItem.get(m.orderItemId) ?? 0) + m.quantity);
  }
  const mergedMoves: SplitMove[] = [...movesByItem.entries()].map(([orderItemId, quantity]) => ({
    orderItemId,
    quantity,
  }));

  const targetIds = mergedMoves.map((m) => m.orderItemId);
  const { data: lines } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .in('id', targetIds);
  if (!lines || lines.length !== new Set(targetIds).size) {
    throw new Error('品目が見つかりません');
  }
  for (const m of mergedMoves) {
    const line = lines.find((l) => l.id === m.orderItemId);
    if (!line) throw new Error('品目が見つかりません');
    if (m.quantity > line.quantity) {
      throw new Error(`「${line.name}」の移動数量が保有数を超えています`);
    }
  }

  const { data: newOrder, error: insErr } = await supabase
    .from('orders')
    .insert({
      organization_id: order.organization_id,
      store_id: order.store_id,
      reservation_id: order.reservation_id,
      customer_id: order.customer_id,
      table_id: order.table_id,
      order_type: order.order_type,
      status: 'open',
      guest_count: 1,
      staff_id: ctx.userId,
      source_order_id: order.id,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (insErr || !newOrder) {
    console.error('[pos.splitOrder] failed to create new order:', insErr);
    throw new Error('伝票分割に失敗しました。通信状態を確認して再度お試しください');
  }
  const newOrderId = newOrder.id as string;

  const movedSummary: { name: string; quantity: number }[] = [];
  for (const m of mergedMoves) {
    const line = lines.find((l) => l.id === m.orderItemId)!;
    movedSummary.push({ name: line.name, quantity: m.quantity });

    if (m.quantity === line.quantity) {
      const { error } = await supabase
        .from('order_items')
        .update({ order_id: newOrderId, updated_by: ctx.userId })
        .eq('id', line.id);
      if (error) {
        console.error('[pos.splitOrder] failed to move item:', error);
        throw new Error('伝票分割に失敗しました。通信状態を確認して再度お試しください');
      }
    } else {
      const remainingQty = line.quantity - m.quantity;
      const { error: updErr } = await supabase
        .from('order_items')
        .update({
          quantity: remainingQty,
          line_total: line.unit_price * remainingQty,
          updated_by: ctx.userId,
        })
        .eq('id', line.id);
      if (updErr) {
        console.error('[pos.splitOrder] failed to shrink item:', updErr);
        throw new Error('伝票分割に失敗しました。通信状態を確認して再度お試しください');
      }
      const { error: insLineErr } = await supabase.from('order_items').insert({
        organization_id: line.organization_id,
        store_id: line.store_id,
        order_id: newOrderId,
        menu_item_id: line.menu_item_id,
        name: line.name,
        unit_price: line.unit_price,
        quantity: m.quantity,
        tax_rate: line.tax_rate,
        tax_included: line.tax_included,
        modifiers: line.modifiers,
        memo: line.memo,
        line_total: line.unit_price * m.quantity,
        staff_id: ctx.userId,
        status: 'active',
        // 元の行がまだ厨房へ未送信なら、分けた側も未送信のまま（既定 now() で勝手に送られないように）
        kitchen_sent_at: line.kitchen_sent_at,
        created_by: ctx.userId,
      });
      if (insLineErr) {
        console.error('[pos.splitOrder] failed to insert moved item:', insLineErr);
        throw new Error('伝票分割に失敗しました。通信状態を確認して再度お試しください');
      }
    }
  }

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  await supabase.rpc('recalc_order_totals', { p_order_id: newOrderId });

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.split',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { order_id: orderId },
    p_after: { new_order_id: newOrderId, moved_items: movedSummary },
    p_note: `伝票分割（新伝票 #${newOrderId}）`,
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  return { newOrderId };
}

/**
 * 伝票統合: 他の会計前伝票のactiveな品目を自伝票へ移動し、相手伝票はvoidにする（物理削除しない）。
 */
export async function mergeOrders(targetOrderId: string, sourceOrderId: string): Promise<void> {
  const ctx = await requirePermission('pos.checkout');
  if (targetOrderId === sourceOrderId) throw new Error('同じ伝票は統合できません');
  const supabase = await createClient();
  const target = await loadOpenOrder(supabase, ctx, targetOrderId);
  const source = await loadOpenOrder(supabase, ctx, sourceOrderId);
  if (source.store_id !== target.store_id) throw new Error('他店舗の伝票とは統合できません');

  const { data: sourceItems } = await supabase
    .from('order_items')
    .select('id, name, quantity, line_total')
    .eq('order_id', sourceOrderId)
    .eq('status', 'active');

  const { error: moveErr } = await supabase
    .from('order_items')
    .update({ order_id: targetOrderId, updated_by: ctx.userId })
    .eq('order_id', sourceOrderId)
    .eq('status', 'active');
  if (moveErr) {
    console.error('[pos.mergeOrders] failed to move items:', moveErr);
    throw new Error('伝票統合に失敗しました。通信状態を確認して再度お試しください');
  }

  const { error: voidErr } = await supabase
    .from('orders')
    .update({
      status: 'void',
      void_reason: '伝票統合のため',
      source_order_id: targetOrderId,
      closed_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq('id', sourceOrderId);
  if (voidErr) {
    console.error('[pos.mergeOrders] failed to void source order:', voidErr);
    throw new Error('伝票統合に失敗しました。通信状態を確認して再度お試しください');
  }

  await supabase
    .from('orders')
    .update({ guest_count: target.guest_count + source.guest_count, updated_by: ctx.userId })
    .eq('id', targetOrderId);

  await supabase.rpc('recalc_order_totals', { p_order_id: targetOrderId });

  await supabase.rpc('log_audit', {
    p_org: target.organization_id,
    p_store: target.store_id,
    p_action: 'order.merge',
    p_target_table: 'orders',
    p_target_id: targetOrderId,
    p_before: { source_order_id: sourceOrderId, source_total: source.total },
    p_after: { merged_from: sourceOrderId, moved_items: sourceItems ?? [] },
    p_note: '伝票統合のため',
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  revalidatePath('/app/floor');
}

/** テーブル移動: 空きテーブルへ席替え。旧テーブルはcleaning・新テーブルはseatedにする */
export async function moveTable(orderId: string, newTableId: string): Promise<{ tableName: string }> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);
  if (!order.table_id) throw new Error('この注文にはテーブルが割り当てられていません');
  if (order.table_id === newTableId) throw new Error('現在と同じテーブルです');

  const { data: newTable } = await supabase
    .from('restaurant_tables')
    .select('id, store_id, current_status, name')
    .eq('id', newTableId)
    .single();
  if (!newTable) throw new Error('移動先テーブルが見つかりません');
  if (newTable.store_id !== order.store_id) throw new Error('他店舗のテーブルへは移動できません');
  if (newTable.current_status !== 'available') throw new Error('このテーブルは現在空席ではありません');

  const oldTableId = order.table_id as string;

  const { error } = await supabase
    .from('orders')
    .update({ table_id: newTableId, updated_by: ctx.userId })
    .eq('id', orderId);
  if (error) {
    console.error('[pos.moveTable] failed to update order:', error);
    throw new Error('テーブル移動に失敗しました。通信状態を確認して再度お試しください');
  }

  await supabase.from('restaurant_tables').update({ current_status: 'cleaning' }).eq('id', oldTableId);
  await supabase.from('restaurant_tables').update({ current_status: 'seated' }).eq('id', newTableId);

  if (order.reservation_id) {
    // フロア表示整合のためのベストエフォート更新（失敗しても本処理は継続）
    await supabase
      .from('reservation_tables')
      .update({ table_id: newTableId })
      .eq('reservation_id', order.reservation_id)
      .eq('table_id', oldTableId);
  }

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.move_table',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { table_id: oldTableId },
    p_after: { table_id: newTableId },
    p_note: null,
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/floor');
  return { tableName: newTable.name };
}

/**
 * 品目のない注文（会計前・¥0）を取消する。
 * 誤ってウォークイン着席した／お客様が注文せずに退店した等で残った空の注文を「会計待ち」から消すための操作。
 * - 有効な品目が1つでも残っていれば取消できない（先に品目取消 or 会計を行う）
 * - 注文は status='cancelled'（取引履歴では「取消」）、理由は void_reason に記録
 * - テーブルは他に会計前の注文が無ければ空席に戻す。紐づく予約（ウォークイン等）は取消扱い
 */
export async function cancelEmptyOrder(orderId: string, reason: string): Promise<void> {
  const ctx = await requirePermission('pos.checkout');
  if (!reason.trim()) throw new Error('取消理由を入力してください');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { count: activeItems } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('status', 'active');
  if ((activeItems ?? 0) > 0) {
    throw new Error('品目が残っている注文は取消できません。先に品目を取消するか、会計してください');
  }

  const { count: paymentCount } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  if ((paymentCount ?? 0) > 0) {
    throw new Error('支払記録のある注文は取消できません。取引履歴から返金・取消してください');
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', void_reason: reason.trim(), closed_at: now, updated_by: ctx.userId })
    .eq('id', orderId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  if (error || !updated) {
    console.error('[pos.cancelEmptyOrder] failed to cancel order:', error);
    throw new Error('注文の取消に失敗しました。通信状態を確認して再度お試しください');
  }

  // テーブル: 同じテーブルに他の会計前注文が無ければ空席へ戻す（フロアマップ整合。失敗しても本処理は継続）
  if (order.table_id) {
    const { count: otherOpen } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('table_id', order.table_id)
      .eq('status', 'open')
      .neq('id', orderId);
    if ((otherOpen ?? 0) === 0) {
      await supabase
        .from('restaurant_tables')
        .update({ current_status: 'available' })
        .eq('id', order.table_id)
        .in('current_status', ['seated', 'ordering', 'billing', 'cleaning']);
    }
  }

  // 予約（ウォークイン含む）: 来店したが注文なしで終了 → 取消扱い。customers.cancel_count は加算しない（店側操作のため）
  if (order.reservation_id) {
    await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancel_reason: `注文取消: ${reason.trim()}`, cancelled_at: now, updated_by: ctx.userId })
      .eq('id', order.reservation_id)
      .in('status', ['confirmed', 'waiting', 'arrived', 'seated', 'billing']);
  }

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.cancel_empty',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { status: 'open', table_id: order.table_id, reservation_id: order.reservation_id },
    p_after: { status: 'cancelled' },
    p_note: reason.trim(),
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  revalidatePath('/app/floor');
  revalidatePath('/app/reservations');
}

/**
 * 会計前の注文の人数を変更する。
 * 着席後に人数が変わる（後から合流した・先に帰った）ことは日常的に起きるため、
 * 伝票・厨房伝票・フロア表示の人数を後から直せるようにする。
 * 金額計算には人数を使っていないため、この操作で合計金額は変わらない。
 */
export async function setGuestCount(orderId: string, guestCount: number): Promise<void> {
  const ctx = await requirePermission('pos.order');
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 999) {
    throw new Error('人数は1〜999名で入力してください');
  }
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);
  if (order.guest_count === guestCount) return;

  const { data: updated, error } = await supabase
    .from('orders')
    .update({ guest_count: guestCount, updated_by: ctx.userId })
    .eq('id', orderId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  if (error || !updated) {
    console.error('[pos.setGuestCount] failed to update order:', error);
    throw new Error('人数の変更に失敗しました。通信状態を確認して再度お試しください');
  }

  // 予約（ウォークイン含む）の人数も揃える。予約表と伝票で人数が食い違うと席割りを誤るため。
  // ベストエフォート（失敗しても人数変更自体は完了している）。
  if (order.reservation_id) {
    await supabase
      .from('reservations')
      .update({ party_size: guestCount, updated_by: ctx.userId })
      .eq('id', order.reservation_id);
  }

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.set_guest_count',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { guest_count: order.guest_count },
    p_after: { guest_count: guestCount },
    p_note: null,
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/floor');
  revalidatePath('/app/reservations');
}

/**
 * 伝票追加: 同じテーブル（またはテイクアウト）に、空の会計前伝票をもう1枚作る。
 * 相席・別会計など「同じ席で財布を分ける」場合に、先に伝票を分けてから注文を取るための操作。
 * 品目を後から分ける splitOrder と違い、既存伝票には一切手を触れない（source_order_id で関連だけ残す）。
 */
export async function addSlipToTable(orderId: string): Promise<{ newOrderId: string; orderNo: number }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: newOrder, error } = await supabase
    .from('orders')
    .insert({
      organization_id: order.organization_id,
      store_id: order.store_id,
      // 予約・顧客は引き継がない（別会計＝別のお客様の財布のため）。席と注文種別のみ揃える。
      table_id: order.table_id,
      order_type: order.order_type,
      status: 'open',
      guest_count: 1,
      staff_id: ctx.userId,
      source_order_id: order.id,
      created_by: ctx.userId,
    })
    .select('id, order_no')
    .single();
  if (error || !newOrder) {
    console.error('[pos.addSlipToTable] failed to create order:', error);
    throw new Error('伝票の追加に失敗しました。通信状態を確認して再度お試しください');
  }

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.add_slip',
    p_target_table: 'orders',
    p_target_id: newOrder.id as string,
    p_before: { source_order_id: orderId },
    p_after: { order_id: newOrder.id, table_id: order.table_id },
    p_note: `伝票追加（元伝票 #${order.order_no}）`,
  });

  revalidatePath('/app/pos');
  revalidatePath('/app/floor');
  return { newOrderId: newOrder.id as string, orderNo: newOrder.order_no as number };
}

/** 印刷実行を記録する */
export async function logPrintJob(orderId: string, jobType: 'receipt' | 'ryoshusho') {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, organization_id, store_id')
    .eq('id', orderId)
    .single();
  if (!order) throw new Error('注文が見つかりません');
  await assertStoreAccess(ctx, order.store_id);

  await supabase.from('print_jobs').insert({
    organization_id: order.organization_id,
    store_id: order.store_id,
    job_type: jobType,
    order_id: orderId,
    status: 'printed',
    target: 'browser',
    printed_at: new Date().toISOString(),
    created_by: ctx.userId,
  });
}

export interface ApplyCouponResult {
  ok: boolean;
  error?: string;
  /** stackable=false のクーポンで既存の値引きがある場合、force:true での再送を促す */
  requiresReplace?: boolean;
  discount?: number;
  name?: string;
}

/**
 * クーポンコードを検証して適用する（lib/coupons の validateCoupon を必ず通す）。
 * discount_total/discount_reason はこの1本の値引き枠を共有するため、適用時に置き換える
 * （stackable=falseで既存の値引きがある場合は force:true が渡されるまで確認を促す）。
 */
export async function applyCoupon(orderId: string, code: string, force = false): Promise<ApplyCouponResult> {
  const ctx = await requirePermission('pos.discount');
  const trimmedCode = code.trim();
  if (!trimmedCode) return { ok: false, error: 'クーポンコードを入力してください' };
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: coupon } = await supabase
    .from('coupons')
    .select('*')
    .eq('organization_id', order.organization_id)
    .eq('code', trimmedCode)
    .maybeSingle();
  if (!coupon) return { ok: false, error: '指定のクーポンコードが見つかりません' };

  if (order.discount_total > 0 && !coupon.stackable && !force) {
    return { ok: false, requiresReplace: true, error: '既存の値引きがあります。置き換えて適用しますか' };
  }

  const [{ count: totalRedemptions }, customerRow] = await Promise.all([
    supabase
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id),
    order.customer_id
      ? supabase.from('customers').select('visit_count').eq('id', order.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  let customerRedemptions = 0;
  if (order.customer_id) {
    const { count } = await supabase
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
      .eq('customer_id', order.customer_id);
    customerRedemptions = count ?? 0;
  }

  const couponLike: CouponLike = {
    id: coupon.id,
    kind: coupon.kind,
    value: coupon.value,
    minTotal: coupon.min_total,
    startsAt: coupon.starts_at ? new Date(coupon.starts_at) : null,
    endsAt: coupon.ends_at ? new Date(coupon.ends_at) : null,
    timeFrom: coupon.time_from,
    timeTo: coupon.time_to,
    maxUses: coupon.max_uses,
    perCustomerLimit: coupon.per_customer_limit,
    firstVisitOnly: coupon.first_visit_only,
    storeId: coupon.store_id,
    status: coupon.status,
  };
  const now = new Date();
  const result = validateCoupon(couponLike, {
    now,
    jstTime: jstTimeHHMM(now),
    // order.total は既存の値引き（手動値引き or 別クーポン）を差し引いた後の金額。
    // クーポンの最低利用額判定・割引率の計算は「値引き前の会計額」に対して行うべきなので、
    // discount_total を足し戻した額（= subtotal+tax+service_charge）を渡す。
    // order.total をそのまま渡すと、既存値引きがある状態でクーポンを置き換えたときに
    // 割引額が実際より小さく計算されてしまう（二重値引き分を誤って差し引くバグ）。
    orderTotal: order.total + order.discount_total,
    storeId: order.store_id,
    customerVisitCount: order.customer_id ? ((customerRow.data as { visit_count: number } | null)?.visit_count ?? 0) : null,
    totalRedemptions: totalRedemptions ?? 0,
    customerRedemptions,
  });
  if (!result.valid) {
    return { ok: false, error: COUPON_REJECT_LABELS[result.reason!] };
  }

  const { error } = await supabase
    .from('orders')
    .update({
      coupon_id: coupon.id,
      coupon_code: coupon.code,
      discount_total: result.discount,
      discount_reason: `${COUPON_PREFIX}${coupon.name}`,
      updated_by: ctx.userId,
    })
    .eq('id', orderId);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.coupon_apply',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { discount_total: order.discount_total },
    p_after: { coupon_code: coupon.code, discount_total: result.discount },
    p_note: null,
  });

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  revalidatePath('/app/pos');
  return { ok: true, discount: result.discount, name: coupon.name };
}

/** クーポン解除（適用時に discount_total/reason を占有しているため、解除時は値引きごと外す） */
export async function clearCoupon(orderId: string): Promise<void> {
  const ctx = await requirePermission('pos.discount');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);
  if (!order.coupon_id) return;

  const { error } = await supabase
    .from('orders')
    .update({
      coupon_id: null,
      coupon_code: null,
      discount_total: 0,
      discount_reason: null,
      updated_by: ctx.userId,
    })
    .eq('id', orderId);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.coupon_clear',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { coupon_code: order.coupon_code },
    p_after: { coupon_code: null },
    p_note: null,
  });

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  revalidatePath('/app/pos');
}

export interface PosCustomerSearchResult {
  id: string;
  name: string;
  phone: string | null;
  pointBalance: number;
}

/** 電話番号（部分一致）で顧客を検索する。伝票への顧客紐付けUIから使用 */
export async function searchCustomerByPhone(phone: string): Promise<PosCustomerSearchResult[]> {
  const ctx = await requirePermission('pos.order');
  const query = phone.trim();
  if (query.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('id, name, phone, point_balance')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .ilike('phone', `%${query}%`)
    .limit(10);
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, pointBalance: c.point_balance }));
}

export interface SetOrderCustomerResult {
  customerName: string | null;
  pointBalance: number | null;
}

/** 伝票へ顧客を紐付ける（customerId=null で解除） */
export async function setOrderCustomer(orderId: string, customerId: string | null): Promise<SetOrderCustomerResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  let customerName: string | null = null;
  let pointBalance: number | null = null;
  if (customerId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, point_balance, organization_id')
      .eq('id', customerId)
      .single();
    if (!customer || customer.organization_id !== order.organization_id) {
      throw new Error('顧客が見つかりません');
    }
    customerName = customer.name;
    pointBalance = customer.point_balance;
  }

  const { error } = await supabase
    .from('orders')
    .update({ customer_id: customerId, updated_by: ctx.userId })
    .eq('id', orderId);
  if (error) throw new Error(error.message);

  revalidatePath('/app/pos');
  return { customerName, pointBalance };
}
