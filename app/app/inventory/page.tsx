import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { yen, formatDate, daysAgoJst, todayJst } from '@/lib/format';
import { suggestReorder } from '@/lib/reorder';
import { forecastUsage, type DailyQty } from '@/lib/forecast';
import { ItemForm } from '@/components/inventory/item-form';
import { ItemTable, type ItemRow } from '@/components/inventory/item-table';
import { StartCountButton } from '@/components/inventory/start-count-button';
import { RequestTransferForm } from '@/components/inventory/request-transfer-form';
import { TransferList, type TransferRow } from '@/components/inventory/transfer-list';
import { ReorderTab, type ReorderRow } from '@/components/inventory/reorder-tab';
import { ForecastChart, type WeekdayAvgPoint } from '@/components/inventory/forecast-chart';
import { ForecastItemSelect } from '@/components/inventory/forecast-item-select';
import {
  ITEM_KIND_LABELS,
  ITEM_KIND_OPTIONS,
  COUNT_STATUS_LABELS,
  COUNT_STATUS_TONES,
  stockWarningLevel,
  type ItemKind,
  type CountStatus,
  type TransferStatus,
} from '@/components/inventory/labels';

export const metadata: Metadata = { title: '在庫' };

type Tab = 'items' | 'counts' | 'transfers' | 'reorder' | 'forecast';
const TABS: { key: Tab; label: string }[] = [
  { key: 'items', label: '品目' },
  { key: 'counts', label: '棚卸' },
  { key: 'transfers', label: '移動' },
  { key: 'reorder', label: '発注提案' },
  { key: 'forecast', label: '予測' },
];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; kind?: string; q?: string; sort?: string; item?: string }>;
}) {
  const ctx = await requireFeature('inventory');
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'items';
  const sortWarning = sp.sort === 'warning';

  if (!ctx.currentStore) {
    return (
      <div>
        <PageHeader title="在庫" />
        <EmptyState
          title="店舗を選択してください"
          description="在庫は店舗ごとに管理します。ヘッダーの店舗切替から対象店舗を選択してください"
        />
      </div>
    );
  }
  const currentStore = ctx.currentStore;

  const supabase = await createClient();
  let itemRows: ItemRow[] = [];
  let countsData: { id: string; countDate: string; status: CountStatus }[] = [];
  let transferRows: TransferRow[] = [];
  let transferItemOptions: { id: string; name: string; unit: string; currentQuantity: number }[] = [];
  let reorderRows: ReorderRow[] = [];
  let forecastItemOptions: { id: string; name: string }[] = [];
  let forecastResult: ReturnType<typeof forecastUsage> | null = null;
  let forecastWeekdayChart: WeekdayAvgPoint[] = [];
  let forecastUnit = '';
  let forecastSelectedName = '';
  let topForecast: { id: string; name: string; unit: string; tomorrow: number }[] = [];

  if (tab === 'items') {
    let q = supabase
      .from('inventory_items')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .eq('status', 'active');
    if (sp.kind) q = q.eq('item_kind', sp.kind);
    if (sp.q) q = q.ilike('name', `%${sp.q}%`);
    const { data } = await q.order('name');
    itemRows = (data ?? []).map((i) => ({
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
    if (sortWarning) {
      const rank = (r: ItemRow) => {
        const w = stockWarningLevel(r);
        return w === 'danger' ? 0 : w === 'warning' ? 1 : 2;
      };
      itemRows = [...itemRows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'));
    }
  } else if (tab === 'counts') {
    const { data } = await supabase
      .from('stock_counts')
      .select('id, count_date, status')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .order('count_date', { ascending: false })
      .limit(100);
    countsData = (data ?? []).map((c) => ({ id: c.id, countDate: c.count_date, status: c.status as CountStatus }));
  } else if (tab === 'transfers') {
    const { data: transfersData } = await supabase
      .from('stock_transfers')
      .select(
        'id, transfer_no, from_store_id, to_store_id, status, note, requested_by, shipped_by, received_by, created_at, stock_transfer_items(id, name, quantity, unit)'
      )
      .eq('organization_id', ctx.organizationId)
      .or(`from_store_id.eq.${currentStore.id},to_store_id.eq.${currentStore.id}`)
      .order('created_at', { ascending: false })
      .limit(100);
    const rows = transfersData ?? [];

    const storeIds = [...new Set(rows.flatMap((r) => [r.from_store_id as string, r.to_store_id as string]))];
    const profileIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.requested_by, r.shipped_by, r.received_by])
          .filter((v): v is string => !!v)
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

    transferRows = rows.map((r) => ({
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
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .eq('status', 'active')
      .order('name');
    transferItemOptions = (ownItems ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      currentQuantity: Number(i.current_quantity),
    }));
  } else if (tab === 'reorder') {
    const { data: activeItems } = await supabase
      .from('inventory_items')
      .select('id, name, unit, current_quantity, reorder_point, min_quantity, optimal_quantity')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .eq('status', 'active')
      .order('name');
    const items = activeItems ?? [];
    const itemIds = items.map((i) => i.id as string);

    const salesByItem = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: sales } = await supabase
        .from('stock_movements')
        .select('inventory_item_id, quantity')
        .eq('store_id', currentStore.id)
        .eq('movement_type', 'sale')
        .gte('business_date', daysAgoJst(30))
        .in('inventory_item_id', itemIds);
      for (const s of sales ?? []) {
        const key = s.inventory_item_id as string;
        salesByItem.set(key, (salesByItem.get(key) ?? 0) - Number(s.quantity));
      }
    }

    const incomingByItem = new Map<string, number>();
    const { data: openPos } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .in('status', ['approved', 'ordered', 'partially_received']);
    const openPoIds = (openPos ?? []).map((p) => p.id as string);
    if (openPoIds.length > 0) {
      const { data: poItems } = await supabase
        .from('purchase_order_items')
        .select('inventory_item_id, quantity, received_quantity')
        .in('purchase_order_id', openPoIds)
        .not('inventory_item_id', 'is', null);
      for (const pi of poItems ?? []) {
        const key = pi.inventory_item_id as string;
        const remaining = Math.max(0, Number(pi.quantity) - Number(pi.received_quantity));
        incomingByItem.set(key, (incomingByItem.get(key) ?? 0) + remaining);
      }
    }

    reorderRows = items.map((i) => {
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
  } else if (tab === 'forecast') {
    const { data: activeItems } = await supabase
      .from('inventory_items')
      .select('id, name, unit')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', currentStore.id)
      .eq('status', 'active')
      .order('name');
    const items = activeItems ?? [];
    forecastItemOptions = items.map((i) => ({ id: i.id, name: i.name }));
    const itemMap = new Map(items.map((i) => [i.id as string, i]));

    const { data: movements } = await supabase
      .from('stock_movements')
      .select('inventory_item_id, quantity, business_date')
      .eq('store_id', currentStore.id)
      .eq('movement_type', 'sale')
      .gte('business_date', daysAgoJst(56));

    const byItemDate = new Map<string, Map<string, number>>();
    const totalByItem = new Map<string, number>();
    for (const m of movements ?? []) {
      const itemId = m.inventory_item_id as string;
      const date = m.business_date as string;
      const qty = -Number(m.quantity);
      const dateMap = byItemDate.get(itemId) ?? new Map<string, number>();
      dateMap.set(date, (dateMap.get(date) ?? 0) + qty);
      byItemDate.set(itemId, dateMap);
      totalByItem.set(itemId, (totalByItem.get(itemId) ?? 0) + qty);
    }

    const today = todayJst();
    const selectedItemId = sp.item && itemMap.has(sp.item) ? sp.item : null;
    if (selectedItemId) {
      const dateMap = byItemDate.get(selectedItemId) ?? new Map<string, number>();
      const history: DailyQty[] = [...dateMap.entries()].map(([date, quantity]) => ({ date, quantity }));
      forecastResult = forecastUsage(history, today);
      forecastUnit = itemMap.get(selectedItemId)?.unit ?? '';
      forecastSelectedName = itemMap.get(selectedItemId)?.name ?? '';
      forecastWeekdayChart = WEEKDAY_LABELS.map((label, idx) => ({
        weekday: label,
        avg: forecastResult!.weekdayAverages[idx],
      }));
    }

    const topIds = [...totalByItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
    topForecast = topIds.map((id) => {
      const item = itemMap.get(id);
      const dateMap = byItemDate.get(id) ?? new Map<string, number>();
      const history: DailyQty[] = [...dateMap.entries()].map(([date, quantity]) => ({ date, quantity }));
      const fc = forecastUsage(history, today);
      return { id, name: item?.name ?? '—', unit: item?.unit ?? '', tomorrow: fc.tomorrow };
    });
  }

  const otherStores = ctx.stores.filter((s) => s.id !== currentStore.id).map((s) => ({ id: s.id, name: s.name }));

  const totalStockValue = itemRows.reduce((sum, r) => sum + Math.round(r.currentQuantity * (r.avgCost ?? 0)), 0);
  const reorderCount = itemRows.filter((r) => r.reorderPoint != null && r.currentQuantity <= r.reorderPoint).length;
  const dangerCount = itemRows.filter((r) => r.minQuantity != null && r.currentQuantity <= r.minQuantity).length;
  const reorderList = itemRows
    .filter((r) => r.reorderPoint != null && r.currentQuantity <= r.reorderPoint)
    .sort((a, b) => a.currentQuantity - b.currentQuantity)
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title="在庫"
        description={`店舗: ${currentStore.name}`}
        actions={
          tab === 'items' ? (
            <ItemForm storeId={currentStore.id} />
          ) : tab === 'counts' ? (
            <StartCountButton storeId={currentStore.id} />
          ) : tab === 'transfers' ? (
            <RequestTransferForm fromStoreId={currentStore.id} otherStores={otherStores} items={transferItemOptions} />
          ) : undefined
        }
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/inventory?tab=${t.key}`}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'items' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="総在庫金額" value={yen(totalStockValue)} tone="primary" />
            <StatCard label="要発注品目数" value={`${reorderCount}件`} tone={reorderCount > 0 ? 'warning' : 'default'} />
            <StatCard
              label="在庫切れ間近品目数"
              value={`${dangerCount}件`}
              tone={dangerCount > 0 ? 'danger' : 'default'}
            />
          </div>

          {reorderList.length > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
              <p className="mb-2 text-xs font-semibold text-warning">
                要発注リスト（発注点以下の品目 {reorderCount}件中 {reorderList.length}件を表示）
              </p>
              <ul className="space-y-1">
                {reorderList.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-navy">
                      {r.name}（現在庫 {r.currentQuantity}
                      {r.unit}／発注点 {r.reorderPoint}
                      {r.unit}）
                    </span>
                    <Link
                      href={`/app/purchases/new?item=${r.id}`}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      発注書を作成
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="items" />
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">種別</label>
              <Select name="kind" defaultValue={sp.kind ?? ''} className="w-40">
                <option value="">すべて</option>
                {ITEM_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {ITEM_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">検索</label>
              <Input name="q" defaultValue={sp.q ?? ''} placeholder="品目名で検索" className="w-48" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">並び順</label>
              <Select name="sort" defaultValue={sp.sort ?? ''} className="w-40">
                <option value="">名前順</option>
                <option value="warning">警告品目を上位に</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              絞り込む
            </Button>
          </form>
          <ItemTable rows={itemRows} otherStores={otherStores} />
        </div>
      )}

      {tab === 'counts' &&
        (countsData.length === 0 ? (
          <EmptyState title="棚卸の記録がありません" description="「棚卸を開始」から新しい棚卸を開始してください" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>実施日</Th>
                  <Th>状態</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {countsData.map((c) => (
                  <Tr key={c.id}>
                    <Td>{formatDate(c.countDate)}</Td>
                    <Td>
                      <Badge tone={COUNT_STATUS_TONES[c.status]}>{COUNT_STATUS_LABELS[c.status]}</Badge>
                    </Td>
                    <Td>
                      <Link href={`/app/inventory/counts/${c.id}`} className="font-medium text-primary hover:underline">
                        開く
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ))}

      {tab === 'transfers' && <TransferList rows={transferRows} currentStoreId={currentStore.id} />}

      {tab === 'reorder' && <ReorderTab rows={reorderRows} />}

      {tab === 'forecast' && (
        <div className="space-y-5">
          <ForecastItemSelect items={forecastItemOptions} selectedId={sp.item ?? null} />

          {!forecastResult ? (
            <EmptyState title="品目を選択してください" description="品目を選ぶと過去8週間の実績から需要予測を表示します" />
          ) : (
            <div className="space-y-4">
              {forecastResult.lowConfidence && (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs font-medium text-warning">
                  データが不足しているため参考値です
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="明日の見込み" value={`${forecastResult.tomorrow}${forecastUnit}`} tone="primary" />
                <StatCard label="今週残りの見込み" value={`${forecastResult.thisWeekRemaining}${forecastUnit}`} />
                <StatCard label="来週の見込み" value={`${forecastResult.nextWeek}${forecastUnit}`} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="mb-3 text-sm font-semibold text-navy">{forecastSelectedName}：曜日別平均使用量</p>
                <ForecastChart data={forecastWeekdayChart} unit={forecastUnit} />
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-semibold text-navy">売れ筋上位10品目の明日見込み</p>
            {topForecast.length === 0 ? (
              <EmptyState title="販売実績がありません" description="過去8週間の販売実績が蓄積すると表示されます" />
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <Tr>
                      <Th>品目</Th>
                      <Th className="text-right">明日の見込み</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {topForecast.map((r) => (
                      <Tr key={r.id}>
                        <Td className="font-medium text-navy">{r.name}</Td>
                        <Td className="text-right tabular-nums">
                          {r.tomorrow}
                          {r.unit}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
