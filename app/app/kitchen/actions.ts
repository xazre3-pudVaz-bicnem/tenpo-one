'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

// pending → preparing → ready → served の一方向遷移のみ許可する
const NEXT_STATUS: Record<KitchenStatus, KitchenStatus | null> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'served',
  served: null,
};

const TIMESTAMP_COLUMN: Record<'preparing' | 'ready' | 'served', 'kitchen_started_at' | 'kitchen_ready_at' | 'served_at'> = {
  preparing: 'kitchen_started_at',
  ready: 'kitchen_ready_at',
  served: 'served_at',
};

function assertStoreAccess(ctx: { isHq: boolean; stores: { id: string }[] }, storeId: string) {
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('この店舗の操作はできません');
  }
}

/** 品目の調理ステータスを次の段階へ進める（未着手→調理中→完成→提供済） */
export async function setItemKitchenStatus(orderItemId: string, nextStatus: KitchenStatus) {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('order_items')
    .select('id, store_id, kitchen_status, status')
    .eq('id', orderItemId)
    .single();
  if (!item) throw new Error('品目が見つかりません');
  assertStoreAccess(ctx, item.store_id);
  if (item.status !== 'active') throw new Error('この品目は取消済みです');

  const currentStatus = item.kitchen_status as KitchenStatus;
  if (NEXT_STATUS[currentStatus] !== nextStatus) {
    throw new Error('この状態遷移はできません');
  }

  const column = TIMESTAMP_COLUMN[nextStatus as 'preparing' | 'ready' | 'served'];
  const { error } = await supabase
    .from('order_items')
    .update({ kitchen_status: nextStatus, [column]: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', orderItemId);
  if (error) throw new Error(error.message);

  revalidatePath('/app/kitchen');
}

/**
 * カード単位で未提供の品目をすべて提供済にする。
 * KDSはステーション（キッチン/ドリンク/デザート）タブで品目を絞り込んで表示するため、
 * onlyItemIds を渡した場合はその品目のみを対象にする（未指定時は注文内の全品目）。
 * これにより、ドリンク担当が「すべて提供済」を押してもキッチン担当の品目まで
 * 誤って提供済にしてしまわないようにする。
 */
export async function markOrderServed(orderId: string, onlyItemIds?: string[]) {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: order } = await supabase.from('orders').select('id, store_id').eq('id', orderId).single();
  if (!order) throw new Error('注文が見つかりません');
  assertStoreAccess(ctx, order.store_id);

  let query = supabase
    .from('order_items')
    .select('id, kitchen_status, kitchen_started_at, kitchen_ready_at')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .neq('kitchen_status', 'served');
  if (onlyItemIds && onlyItemIds.length > 0) query = query.in('id', onlyItemIds);
  const { data: items } = await query;
  if (!items || items.length === 0) return;

  const now = new Date().toISOString();
  // 途中の段階を飛ばして「すべて提供済」にする場合も、未記録のタイムスタンプは提供時刻で補完する
  await Promise.all(
    items.map((it) =>
      supabase
        .from('order_items')
        .update({
          kitchen_status: 'served',
          kitchen_started_at: it.kitchen_started_at ?? now,
          kitchen_ready_at: it.kitchen_ready_at ?? now,
          served_at: now,
          updated_by: ctx.userId,
        })
        .eq('id', it.id)
    )
  );

  revalidatePath('/app/kitchen');
}
