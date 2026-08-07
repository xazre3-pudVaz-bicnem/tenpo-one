import type { Metadata } from 'next';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { KdsBoard } from '@/components/kitchen/kds-board';
import { setItemKitchenStatus, markOrderServed, updateKdsSettings } from './actions';
import { DEFAULT_KDS_SETTINGS, type KdsItem, type KdsOrderGroup, type KdsSettings, type Station } from '@/components/kitchen/types';

export const metadata: Metadata = { title: 'キッチン（KDS）' };

/** 「提供済を表示」トグルで確認できる、提供済品目の保持期間 */
const RECENT_SERVED_WINDOW_MS = 60 * 60 * 1000;

interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  quantity: number;
  memo: string | null;
  modifiers: { name: string; price: number }[] | null;
  kitchen_status: string;
  created_at: string;
  orders: {
    order_no: number;
    order_source: string;
    restaurant_tables: { name: string } | null;
  } | null;
}

export default async function KitchenPage() {
  await requireFeature('kds');
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

  const { data: storeSettings } = await supabase
    .from('store_settings')
    .select('kds_settings')
    .eq('store_id', store.id)
    .maybeSingle();
  const savedKdsSettings = storeSettings?.kds_settings as Partial<KdsSettings> | null;
  const kdsSettings: KdsSettings = {
    warn1: savedKdsSettings?.warn1 ?? DEFAULT_KDS_SETTINGS.warn1,
    warn2: savedKdsSettings?.warn2 ?? DEFAULT_KDS_SETTINGS.warn2,
    warn3: savedKdsSettings?.warn3 ?? DEFAULT_KDS_SETTINGS.warn3,
    aggregate: savedKdsSettings?.aggregate ?? DEFAULT_KDS_SETTINGS.aggregate,
    sound: savedKdsSettings?.sound ?? DEFAULT_KDS_SETTINGS.sound,
  };

  const { data: rows } = await supabase
    .from('order_items')
    .select(
      `id, order_id, menu_item_id, name, quantity, memo, modifiers, kitchen_status, created_at,
       orders!inner(order_no, order_source, status, restaurant_tables(name))`
    )
    .eq('store_id', store.id)
    .eq('status', 'active')
    .eq('orders.status', 'open')
    .or(`kitchen_status.neq.served,served_at.gt.${sinceIso}`)
    .order('created_at', { ascending: true });

  const typedRows = (rows ?? []) as unknown as OrderItemRow[];

  // menu_item_id → menu_categories.station を解決する（未紐付けは「キッチン」扱い）
  const menuItemIds = [...new Set(typedRows.map((r) => r.menu_item_id).filter((v): v is string => !!v))];
  const stationByItem = new Map<string, Station>();
  if (menuItemIds.length > 0) {
    const { data: menuItemRows } = await supabase.from('menu_items').select('id, category_id').in('id', menuItemIds);
    const categoryIds = [...new Set((menuItemRows ?? []).map((m) => m.category_id).filter((v): v is string => !!v))];
    let stationByCategory = new Map<string, Station>();
    if (categoryIds.length > 0) {
      const { data: categoryRows } = await supabase.from('menu_categories').select('id, station').in('id', categoryIds);
      stationByCategory = new Map((categoryRows ?? []).map((c) => [c.id as string, c.station as Station]));
    }
    for (const m of menuItemRows ?? []) {
      stationByItem.set(m.id as string, (m.category_id && stationByCategory.get(m.category_id)) || 'kitchen');
    }
  }

  const groupsMap = new Map<string, KdsOrderGroup>();
  const activeTimesMap = new Map<string, number[]>();

  for (const r of typedRows) {
    const order = r.orders;
    const item: KdsItem = {
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      memo: r.memo,
      modifiers: r.modifiers ?? [],
      station: r.menu_item_id ? (stationByItem.get(r.menu_item_id) ?? 'kitchen') : 'kitchen',
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
        storeId={store.id}
        groups={groups}
        now={now}
        unservedCount={unservedCount}
        avgElapsedMinutes={avgElapsedMinutes}
        kdsSettings={kdsSettings}
        canManageSettings={can(ctx.role, 'store.settings')}
        setItemStatusAction={setItemKitchenStatus}
        markOrderServedAction={markOrderServed}
        updateKdsSettingsAction={updateKdsSettings}
      />
    </div>
  );
}
