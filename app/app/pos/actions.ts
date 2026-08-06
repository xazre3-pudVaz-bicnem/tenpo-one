'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { applicableTaxRate } from '@/lib/tax';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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
  const isTakeoutLike = order.order_type === 'takeout' || order.order_type === 'delivery';
  const unitPrice = isTakeoutLike ? (item.takeout_price ?? item.price) : item.price;
  const taxRate = isTakeoutLike
    ? applicableTaxRate(order.order_type as 'takeout' | 'delivery', item.item_type === 'drink')
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

  const { error } = await supabase
    .from('orders')
    .update({ discount_total: discountTotal, discount_reason: reason || null, updated_by: ctx.userId })
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
  method: 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account';
  amount: number;
  tendered?: number;
}

/** 会計確定。レジ未開局の場合は register_session_id=null で確定し warning を返す */
export async function checkout(
  orderId: string,
  payments: CheckoutPayment[]
): Promise<{ ok: true; warning: string | null }> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const order = await loadOpenOrder(supabase, ctx, orderId);

  const { data: session } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('store_id', order.store_id)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.rpc('finalize_order', {
    p_order_id: orderId,
    p_payments: payments,
    p_register_session_id: session?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  revalidatePath('/app/floor');

  const hasCash = payments.some((p) => p.method === 'cash');
  const warning =
    !session && hasCash ? '現金がレジ台帳に計上されていません。レジを開局してください' : null;
  return { ok: true, warning };
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
