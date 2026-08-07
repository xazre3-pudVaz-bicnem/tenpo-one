import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { KdsBoard } from '@/components/kitchen/kds-board';
import { setItemKitchenStatus, markOrderServed } from './actions';
import type { KdsItem, KdsOrderGroup } from '@/components/kitchen/types';

export const metadata: Metadata = { title: 'キッチン（KDS）' };

/** 「提供済を表示」トグルで確認できる、提供済品目の保持期間 */
const RECENT_SERVED_WINDOW_MS = 60 * 60 * 1000;

interface OrderItemRow {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  memo: string | null;
  kitchen_status: string;
  created_at: string;
  orders: {
    order_no: number;
    order_source: string;
    restaurant_tables: { name: string } | null;
  } | null;
}

export default async function KitchenPage() {
  const ctx = await requirePermission('pos.order');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="キッチン" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const sinceIso = new Date(new Date().getTime() - RECENT_SERVED_WINDOW_MS).toISOString();

  const { data: rows } = await supabase
    .from('order_items')
    .select(
      `id, order_id, name, quantity, memo, kitchen_status, created_at,
       orders!inner(order_no, order_source, status, restaurant_tables(name))`
    )
    .eq('store_id', store.id)
    .eq('status', 'active')
    .eq('orders.status', 'open')
    .or(`kitchen_status.neq.served,served_at.gt.${sinceIso}`)
    .order('created_at', { ascending: true });

  const groupsMap = new Map<string, KdsOrderGroup>();
  const activeTimesMap = new Map<string, number[]>();

  for (const r of (rows ?? []) as unknown as OrderItemRow[]) {
    const order = r.orders;
    const item: KdsItem = {
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      memo: r.memo,
      kitchenStatus: r.kitchen_status as KdsItem['kitchenStatus'],
      createdAt: r.created_at,
    };

    let group = groupsMap.get(r.order_id);
    if (!group) {
      group = {
        orderId: r.order_id,
        orderNo: order?.order_no ?? 0,
        tableName: order?.restaurant_tables?.name ?? null,
        orderSource: (order?.order_source as KdsOrderGroup['orderSource']) ?? 'pos',
        orderTime: r.created_at,
        items: [],
      };
      groupsMap.set(r.order_id, group);
      activeTimesMap.set(r.order_id, []);
    }
    group.items.push(item);
    if (item.kitchenStatus !== 'served') {
      activeTimesMap.get(r.order_id)!.push(new Date(item.createdAt).getTime());
    }
  }

  const groups: KdsOrderGroup[] = [...groupsMap.values()]
    .map((g) => {
      const times = activeTimesMap.get(g.orderId) ?? [];
      // 未提供品目があればその中で最も古い時刻、なければ全品目の最も古い時刻を「注文時刻」とする
      // （同じ open な注文へ後から追加された新規品目の待ち時間を、古い注文時刻に引きずられさせないため）
      const pool = times.length > 0 ? times : g.items.map((i) => new Date(i.createdAt).getTime());
      return { ...g, orderTime: new Date(Math.min(...pool)).toISOString() };
    })
    .sort((a, b) => new Date(a.orderTime).getTime() - new Date(b.orderTime).getTime());

  const now = new Date().getTime();
  const unservedCount = groups.reduce((sum, g) => sum + g.items.filter((i) => i.kitchenStatus !== 'served').length, 0);
  const activeGroups = groups.filter((g) => g.items.some((i) => i.kitchenStatus !== 'served'));
  const avgElapsedMinutes =
    activeGroups.length > 0
      ? Math.round(
          activeGroups.reduce((sum, g) => sum + (now - new Date(g.orderTime).getTime()) / 60000, 0) /
            activeGroups.length
        )
      : 0;

  return (
    <div>
      <PageHeader title="キッチン" description={`${store.name}｜注文の古い順に表示`} />
      <KdsBoard
        groups={groups}
        now={now}
        unservedCount={unservedCount}
        avgElapsedMinutes={avgElapsedMinutes}
        setItemStatusAction={setItemKitchenStatus}
        markOrderServedAction={markOrderServed}
      />
    </div>
  );
}
