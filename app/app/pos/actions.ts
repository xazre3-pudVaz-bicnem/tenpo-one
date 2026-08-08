'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { applicableTaxRate } from '@/lib/tax';
import { validateCoupon, COUPON_REJECT_LABELS, type CouponLike } from '@/lib/coupons';

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

async function assertStoreAccess(
  ctx: { isHq: boolean; stores: { id: string }[] },
  storeId: string
) {
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('この店舗の操作はできません');
  }
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
export async function addItem(orderId: string, menuItemId: string) {
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

  const { error } = await supabase.from('order_items').insert({
    organization_id: order.organization_id,
    store_id: order.store_id,
    order_id: orderId,
    menu_item_id: item.id,
    name: item.name,
    unit_price: unitPrice,
    quantity: 1,
    tax_rate: taxRate,
    tax_included: taxIncluded,
    line_total: unitPrice,
    staff_id: ctx.userId,
    status: 'active',
    created_by: ctx.userId,
  });
  if (error) throw new Error(error.message);

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  revalidatePath(`/app/pos`);
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
  method: 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account' | 'points';
  amount: number;
  tendered?: number;
}

export interface CheckoutOutcome {
  ok: boolean;
  /** true の場合は二重会計等で既に確定済み。エラーではなく案内として扱う */
  alreadyPaid?: boolean;
  warning?: string | null;
  /** finalize_order が返す今回付与ポイント数（0以下は付与なし） */
  pointsEarned?: number;
}

/**
 * 会計確定。レジ未開局の場合は register_session_id=null で確定し warning を返す。
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

  const { data, error } = await supabase.rpc('finalize_order', {
    p_order_id: orderId,
    p_payments: payments,
    p_register_session_id: session?.id ?? null,
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

  const hasCash = payments.some((p) => p.method === 'cash');
  const warning =
    !session && hasCash ? '現金がレジ台帳に計上されていません。レジを開局してください' : null;
  const result = data as { points_earned?: number } | null;
  return { ok: true, warning, pointsEarned: result?.points_earned ?? 0 };
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
