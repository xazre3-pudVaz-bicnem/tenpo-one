'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** 返金（全額デフォルト・理由必須）。RPC refund_order を使用する */
export async function refundOrder(
  orderId: string,
  amount: number,
  method: 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account',
  reason: string
) {
  const ctx = await requirePermission('pos.refund');
  if (amount <= 0) throw new Error('返金額が不正です');
  if (!reason.trim()) throw new Error('返金理由を入力してください');

  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, organization_id')
    .eq('id', orderId)
    .single();
  if (!order) throw new Error('注文が見つかりません');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) {
    throw new Error('この店舗の操作はできません');
  }

  const { data: session } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('store_id', order.store_id)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.rpc('refund_order', {
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
    p_reason: reason,
    p_register_session_id: session?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath('/app/orders');
}

/**
 * 再会計: 全額返金済み（status='refunded' かつ 返金合計=支払合計）の取引のみ、
 * activeだった品目を複製した新しい注文(open)を作成する。元取引はrefundedのまま残す（物理削除なし）。
 */
export async function reopenOrder(orderId: string, reason: string): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.refund');
  if (!reason.trim()) throw new Error('再会計理由を入力してください');
  const supabase = await createClient();

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error('注文が見つかりません');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) {
    throw new Error('この店舗の操作はできません');
  }
  if (order.status !== 'refunded') {
    throw new Error('先に全額返金してください');
  }

  const [{ data: payments }, { data: refunds }, { data: existingDerived }] = await Promise.all([
    supabase.from('payments').select('amount').eq('order_id', orderId).eq('status', 'completed'),
    supabase.from('refunds').select('amount').eq('order_id', orderId),
    supabase.from('orders').select('id').eq('source_order_id', orderId).eq('status', 'open').limit(1).maybeSingle(),
  ]);
  const totalPaid = (payments ?? []).reduce((a, p) => a + p.amount, 0);
  const totalRefunded = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  if (totalPaid <= 0 || totalRefunded < totalPaid) {
    throw new Error('先に全額返金してください');
  }
  if (existingDerived) {
    throw new Error('この取引の再会計伝票は既に作成されています');
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('status', 'active');

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
      guest_count: order.guest_count,
      staff_id: ctx.userId,
      source_order_id: order.id,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (insErr || !newOrder) {
    console.error('[orders.reopenOrder] failed to create new order:', insErr);
    throw new Error('再会計に失敗しました。通信状態を確認して再度お試しください');
  }
  const newOrderId = newOrder.id as string;

  if (items && items.length > 0) {
    const rows = items.map((it) => ({
      organization_id: it.organization_id,
      store_id: it.store_id,
      order_id: newOrderId,
      menu_item_id: it.menu_item_id,
      name: it.name,
      unit_price: it.unit_price,
      quantity: it.quantity,
      tax_rate: it.tax_rate,
      tax_included: it.tax_included,
      modifiers: it.modifiers,
      memo: it.memo,
      line_total: it.line_total,
      staff_id: ctx.userId,
      status: 'active',
      created_by: ctx.userId,
    }));
    const { error: itemsErr } = await supabase.from('order_items').insert(rows);
    if (itemsErr) {
      console.error('[orders.reopenOrder] failed to duplicate items:', itemsErr);
      throw new Error('再会計に失敗しました。通信状態を確認して再度お試しください');
    }
  }

  await supabase.rpc('recalc_order_totals', { p_order_id: newOrderId });

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.reopen',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { status: order.status },
    p_after: { new_order_id: newOrderId },
    p_note: reason,
  });

  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath('/app/orders');
  revalidatePath('/app/pos');
  return { orderId: newOrderId };
}
