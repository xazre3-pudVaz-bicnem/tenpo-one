import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst, todayJst } from '@/lib/format';
import { suggestReorder } from '@/lib/reorder';
import { forecastUsage, type DailyQty } from '@/lib/forecast';
import { isPriceIncreaseSignificant } from '@/lib/metrics';
import { stockWarningLevel, type ItemKind, type CountStatus, type TransferStatus } from '@/components/inventory/labels';
import type { ItemRow } from '@/components/inventory/item-table';
import type { TransferRow } from '@/components/inventory/transfer-list';
import type { ReorderRow } from '@/components/inventory/reorder-tab';

/**
 * 在庫（/app/inventory）の各タブの読み込み。Web の画面と iPad アプリのネイティブ画面（GET ?part=inventory）で同じものを使う。
 * 中身は app/app/inventory/page.tsx にあったものをそのまま移した（2026-10-24）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 品目タブ：品目と「値上がり」（前回仕入が前々回比10%以上）の品目ID */
export async function loadInventoryItems(
  supabase: Supabase,
  organizationId: string,
  storeId: string,
  q: { kind?: string; q?: string; sortWarning: boolean }
): Promise<{ rows: ItemRow[]; priceIncreaseItemIds: Set<string> }> {
  let query = supabase
    .from('inventory_items')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'active');
  if (q.kind) query = query.eq('item_kind', q.kind);
  if (q.q) query = query.ilike('name', `%${q.q}%`);
  const { data } = await query.order('name');
  let rows: ItemRow[] = (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    itemKind: i.item_kind as ItemKind,
    category: i.category,
    unit: i.unit,
    currentQuantity: Number(i.current_quantity),
    reorderPoint: i.reorder_point != null ? Number(i.reorder_point) : null,
    minQuantity: i.min_quantity != null ? Number(i.min_quantity) : null,
    optimalQuantity: i.optimal_quantity != null ? Number(i.optimal_quantity) : null,
    avgCost: i.avg_cost,
    lastPurchaseCost: i.last_purchase_cost,
    purchaseUnit: i.purchase_unit,
    purchaseToStockFactor: Number(i.purchase_to_stock_factor ?? 1),
  }));
  if (q.sortWarning) {
    const rank = (r: ItemRow) => {
      const w = stockWarningLevel(r);
      return w === 'danger' ? 0 : w === 'warning' ? 1 : 2;
    };
    rows = [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'));
  }

  // 値上がり品目の判定: 品目ごと直近2件の入荷単価（'in'）を isPriceIncreaseSignificant で比較する
  const priceIncreaseItemIds = new Set<string>();
  const itemIds = rows.map((r) => r.id);
  if (itemIds.length > 0) {
    const { data: recentReceipts } = await supabase
      .from('stock_movements')
      .select('inventory_item_id, unit_cost, occurred_at')
      .eq('store_id', storeId)
      .eq('movement_type', 'in')
      .in('inventory_item_id', itemIds)
      .order('occurred_at', { ascending: false })
      .limit(2000);
    const lastTwoByItem = new Map<string, number[]>();
    for (const m of recentReceipts ?? []) {
      if (m.unit_cost == null) continue;
      const key = m.inventory_item_id as string;
      const list = lastTwoByItem.get(key) ?? [];
      if (list.length < 2) {
        list.push(m.unit_cost as number);
        lastTwoByItem.set(key, list);
      }
    }
    for (const [itemId, costs] of lastTwoByItem) {
      if (costs.length === 2 && isPriceIncreaseSignificant(costs[0], costs[1])) {
        priceIncreaseItemIds.add(itemId);
      }
    }
  }
  return { rows, priceIncreaseItemIds };
}

/** 棚卸タブ：直近100件 */
export async function loadInventoryCounts(
  supabase: Supabase,
  organizationId: string,
  storeId: string
): Promise<{ id: string; countDate: string; status: CountStatus }[]> {
  const { data } = await supabase
    .from('stock_counts')
    .select('id, count_date, status')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .order('count_date', { ascending: false })
    .limit(100);
  return (data ?? []).map((c) => ({ id: c.id, countDate: c.count_date, status: c.status as CountStatus }));
}

/** 移動タブ：自店が送り元・受け取り先の移動（直近100件）と、申請に使う自店の品目 */
export async function loadInventoryTransfers(
  supabase: Supabase,
  organizationId: string,
  storeId: string
): Promise<{ rows: TransferRow[]; itemOptions: { id: string; name: string; unit: string; currentQuantity: number }[] }> {
  const { data: transfersData } = await supabase
    .from('stock_transfers')
    .select(
      'id, transfer_no, from_store_id, to_store_id, status, note, requested_by, shipped_by, received_by, created_at, stock_transfer_items(id, name, quantity, unit)'
    )
    .eq('organization_id', organizationId)
    .or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`)
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = transfersData ?? [];

  const storeIds = [...new Set(rows.flatMap((r) => [r.from_store_id as string, r.to_store_id as string]))];
  const profileIds = [
    ...new Set(
      rows.flatMap((r) => [r.requested_by, r.shipped_by, r.received_by]).filter((v): v is string => !!v)
    ),
  ];
  const [{ data: storesData }, { data: profilesData }] = await Promise.all([
    storeIds.length > 0
      ? supabase.from('stores').select('id, name').in('id', storeIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    profileIds.length > 0
      ? supabase.from('profiles').select('id, display_name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const storeNames = new Map((storesData ?? []).map((s) => [s.id as string, s.name as string]));
  const profileNames = new Map((profilesData ?? []).map((p) => [p.id as string, p.display_name as string]));

  const transferRows: TransferRow[] = rows.map((r) => ({
    id: r.id as string,
    transferNo: Number(r.transfer_no),
    fromStoreId: r.from_store_id as string,
    fromStoreName: storeNames.get(r.from_store_id as string) ?? '—',
    toStoreId: r.to_store_id as string,
    toStoreName: storeNames.get(r.to_store_id as string) ?? '—',
    status: r.status as TransferStatus,
    note: r.note as string | null,
    requestedByName: r.requested_by ? (profileNames.get(r.requested_by as string) ?? null) : null,
    shippedByName: r.shipped_by ? (profileNames.get(r.shipped_by as string) ?? null) : null,
    receivedByName: r.received_by ? (profileNames.get(r.received_by as string) ?? null) : null,
    createdAt: r.created_at as string,
    items: ((r.stock_transfer_items ?? []) as { id: string; name: string; quantity: number; unit: string }[]).map(
      (it) => ({ id: it.id, name: it.name, quantity: Number(it.quantity), unit: it.unit })
    ),
  }));

  const { data: ownItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit, current_quantity')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'active')
    .order('name');
  const itemOptions = (ownItems ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    currentQuantity: Number(i.current_quantity),
  }));
  return { rows: transferRows, itemOptions };
}

/** 発注提案タブ：過去30日の販売と発注中の入荷待ちから推奨発注数 */
export async function loadInventoryReorder(supabase: Supabase, organizationId: string, storeId: string): Promise<ReorderRow[]> {
  // 在庫品目(activeItems)と発注中PO(openPos)は独立のため並列取得する。
  const [{ data: activeItems }, { data: openPos }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id, name, unit, current_quantity, reorder_point, min_quantity, optimal_quantity')
      .eq('organization_id', organizationId)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('purchase_orders')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('store_id', storeId)
      .in('status', ['approved', 'ordered', 'partially_received']),
  ]);
  const items = activeItems ?? [];
  const itemIds = items.map((i) => i.id as string);
  const openPoIds = (openPos ?? []).map((p) => p.id as string);

  // 販売実績(sales)とPO明細(poItems)も相互に独立のため並列取得する。
  const [{ data: sales }, { data: poItems }] = await Promise.all([
    itemIds.length > 0
      ? supabase
          .from('stock_movements')
          .select('inventory_item_id, quantity')
          .eq('store_id', storeId)
          .eq('movement_type', 'sale')
          .gte('business_date', daysAgoJst(30))
          .in('inventory_item_id', itemIds)
      : Promise.resolve({ data: [] as { inventory_item_id: string | null; quantity: number }[] }),
    openPoIds.length > 0
      ? supabase
          .from('purchase_order_items')
          .select('inventory_item_id, quantity, received_quantity')
          .in('purchase_order_id', openPoIds)
          .not('inventory_item_id', 'is', null)
      : Promise.resolve({ data: [] as { inventory_item_id: string | null; quantity: number; received_quantity: number }[] }),
  ]);

  const salesByItem = new Map<string, number>();
  for (const s of sales ?? []) {
    const key = s.inventory_item_id as string;
    salesByItem.set(key, (salesByItem.get(key) ?? 0) - Number(s.quantity));
  }
  const incomingByItem = new Map<string, number>();
  for (const pi of poItems ?? []) {
    const key = pi.inventory_item_id as string;
    const remaining = Math.max(0, Number(pi.quantity) - Number(pi.received_quantity));
    incomingByItem.set(key, (incomingByItem.get(key) ?? 0) + remaining);
  }

  return items.map((i) => {
    const avgDailySales = Math.round(((salesByItem.get(i.id as string) ?? 0) / 30) * 100) / 100;
    const incomingQuantity = Math.round((incomingByItem.get(i.id as string) ?? 0) * 100) / 100;
    const suggestion = suggestReorder(
      {
        currentQuantity: Number(i.current_quantity),
        optimalQuantity: i.optimal_quantity != null ? Number(i.optimal_quantity) : null,
        minQuantity: i.min_quantity != null ? Number(i.min_quantity) : null,
        reorderPoint: i.reorder_point != null ? Number(i.reorder_point) : null,
        avgDailySales,
        leadTimeDays: 3,
      },
      incomingQuantity
    );
    return {
      id: i.id as string,
      name: i.name as string,
      unit: i.unit as string,
      currentQuantity: Number(i.current_quantity),
      avgDailySales,
      incomingQuantity,
      needed: suggestion.needed,
      suggestedQuantity: suggestion.suggestedQuantity,
      basis: suggestion.basis,
    };
  });
}

export interface InventoryForecastData {
  itemOptions: { id: string; name: string }[];
  /** 品目を選んだときだけ */
  result: ReturnType<typeof forecastUsage> | null;
  weekdayChart: { weekday: string; avg: number }[];
  unit: string;
  selectedName: string;
  /** 売れ筋上位10品目の明日見込み */
  top: { id: string; name: string; unit: string; tomorrow: number }[];
}

/** 予測タブ：過去8週間の販売から */
export async function loadInventoryForecast(
  supabase: Supabase,
  organizationId: string,
  storeId: string,
  itemId: string | undefined
): Promise<InventoryForecastData> {
  // 在庫品目(activeItems)と販売実績(movements)は独立のため並列取得する。
  const [{ data: activeItems }, { data: movements }] = await Promise.all([
    supabase
      .from('inventory_items')
      .select('id, name, unit')
      .eq('organization_id', organizationId)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('stock_movements')
      .select('inventory_item_id, quantity, business_date')
      .eq('store_id', storeId)
      .eq('movement_type', 'sale')
      .gte('business_date', daysAgoJst(56)),
  ]);
  const items = activeItems ?? [];
  const itemOptions = items.map((i) => ({ id: i.id as string, name: i.name as string }));
  const itemMap = new Map(items.map((i) => [i.id as string, i]));

  const byItemDate = new Map<string, Map<string, number>>();
  const totalByItem = new Map<string, number>();
  for (const m of movements ?? []) {
    const id = m.inventory_item_id as string;
    const date = m.business_date as string;
    const qty = -Number(m.quantity);
    const dateMap = byItemDate.get(id) ?? new Map<string, number>();
    dateMap.set(date, (dateMap.get(date) ?? 0) + qty);
    byItemDate.set(id, dateMap);
    totalByItem.set(id, (totalByItem.get(id) ?? 0) + qty);
  }

  const today = todayJst();
  let result: ReturnType<typeof forecastUsage> | null = null;
  let weekdayChart: { weekday: string; avg: number }[] = [];
  let unit = '';
  let selectedName = '';
  const selectedItemId = itemId && itemMap.has(itemId) ? itemId : null;
  if (selectedItemId) {
    const dateMap = byItemDate.get(selectedItemId) ?? new Map<string, number>();
    const history: DailyQty[] = [...dateMap.entries()].map(([date, quantity]) => ({ date, quantity }));
    const r = forecastUsage(history, today);
    result = r;
    unit = (itemMap.get(selectedItemId)?.unit as string) ?? '';
    selectedName = (itemMap.get(selectedItemId)?.name as string) ?? '';
    weekdayChart = WEEKDAY_LABELS.map((label, idx) => ({ weekday: label, avg: r.weekdayAverages[idx] }));
  }

  const topIds = [...totalByItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const top = topIds.map((id) => {
    const item = itemMap.get(id);
    const dateMap = byItemDate.get(id) ?? new Map<string, number>();
    const history: DailyQty[] = [...dateMap.entries()].map(([date, quantity]) => ({ date, quantity }));
    const fc = forecastUsage(history, today);
    return { id, name: (item?.name as string) ?? '—', unit: (item?.unit as string) ?? '', tomorrow: fc.tomorrow };
  });

  return { itemOptions, result, weekdayChart, unit, selectedName, top };
}
