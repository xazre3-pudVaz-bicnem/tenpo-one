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
