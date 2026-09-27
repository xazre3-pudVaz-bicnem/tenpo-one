import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export type DiscardResult = { discarded: true } | { discarded: false; reason: string };

/**
 * 「注文」を押して伝票を立てたが、品を1つも入れずに（Order をスワイプせずに）画面を離れた伝票を、
 * 何も無かったことにする（2026-09-28 Ronnie「Order を決定していなければ、その卓に ¥0 で残らない。何も起きていない状態に」）。
 *
 * 消すのは「品が1つも入ったことがなく、支払も無い、会計前の伝票」だけ。品を入れて取消した伝票（厨房に出た可能性）や
 * 会計済みは触らない。卓は他に会計前の伝票が無ければ空席へ、ウォークインの予約は取消扱い。
 * 理由・承認は要らない（誰も何もしていない伝票なので）。
 */
export async function discardUntouchedOrder(
  supabase: AnyClient,
  ctx: { userId: string; organizationId: string; stores: { id: string }[]; isHq: boolean },
  orderId: string
): Promise<DiscardResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, organization_id, store_id, table_id, reservation_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { discarded: false, reason: '注文が見つかりません' };
  if (order.organization_id !== ctx.organizationId) return { discarded: false, reason: 'この注文は操作できません' };
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) return { discarded: false, reason: 'この店舗へのアクセス権がありません' };
  if (order.status !== 'open') return { discarded: false, reason: '会計前の注文ではありません' };

  const [{ count: anyItems }, { count: payments }] = await Promise.all([
    supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
  ]);
  if ((anyItems ?? 0) > 0) return { discarded: false, reason: '品が入っている伝票はそのまま' };
  if ((payments ?? 0) > 0) return { discarded: false, reason: '支払のある伝票はそのまま' };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', void_reason: '注文せずに戻った（自動）', closed_at: now, updated_by: ctx.userId })
    .eq('id', orderId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();
  if (error || !updated) return { discarded: false, reason: error?.message ?? '取消できませんでした' };

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
  if (order.reservation_id) {
    await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancel_reason: '注文せずに戻った（自動）', cancelled_at: now, updated_by: ctx.userId })
      .eq('id', order.reservation_id)
      .in('status', ['confirmed', 'waiting', 'arrived', 'seated', 'billing']);
  }
  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.discard_untouched',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { status: 'open', table_id: order.table_id, reservation_id: order.reservation_id },
    p_after: { status: 'cancelled' },
    p_note: '品を入れずに画面を離れた伝票を自動で取消',
  });
  return { discarded: true };
}
