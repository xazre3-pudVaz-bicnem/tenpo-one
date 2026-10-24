import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
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
import { yen, formatDate } from '@/lib/format';
import {
  loadInventoryItems,
  loadInventoryCounts,
  loadInventoryTransfers,
  loadInventoryReorder,
  loadInventoryForecast,
  type InventoryForecastData,
} from '@/lib/inventory-data-server';
import { ItemForm } from '@/components/inventory/item-form';
import { ItemTable, type ItemRow } from '@/components/inventory/item-table';
import { StartCountButton } from '@/components/inventory/start-count-button';
import { RequestTransferForm } from '@/components/inventory/request-transfer-form';
import { TransferList, type TransferRow } from '@/components/inventory/transfer-list';
import { ReorderTab, type ReorderRow } from '@/components/inventory/reorder-tab';
import { ForecastChart, type WeekdayAvgPoint } from '@/components/inventory/forecast-chart';
import { ForecastItemSelect } from '@/components/inventory/forecast-item-select';
import { MenuStockPanel, type MenuStockRow } from '@/components/inventory/menu-stock-panel';
import { loadMenuStock } from '@/lib/menu-stock-server';
import { setMenuStockLimit } from './menu-stock-actions';
import {
  ITEM_KIND_LABELS,
  ITEM_KIND_OPTIONS,
  COUNT_STATUS_LABELS,
  COUNT_STATUS_TONES,
  type CountStatus,
} from '@/components/inventory/labels';

export const metadata: Metadata = { title: '在庫' };

type Tab = 'items' | 'menu' | 'counts' | 'transfers' | 'reorder' | 'forecast';
const TABS: { key: Tab; label: string }[] = [
  { key: 'items', label: '品目' },
  { key: 'menu', label: 'メニュー売切' },
  { key: 'counts', label: '棚卸' },
  { key: 'transfers', label: '移動' },
  { key: 'reorder', label: '発注提案' },
  { key: 'forecast', label: '予測' },
];

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
  /** isPriceIncreaseSignificant（前回比10%以上値上がり）に該当する品目ID（v0.4.3 仕入価格履歴） */
  let priceIncreaseItemIds = new Set<string>();
  let countsData: { id: string; countDate: string; status: CountStatus }[] = [];
  let transferRows: TransferRow[] = [];
  let transferItemOptions: { id: string; name: string; unit: string; currentQuantity: number }[] = [];
  let reorderRows: ReorderRow[] = [];
  let forecastItemOptions: { id: string; name: string }[] = [];
  /** メニュー売切タブ（本日の食数）の行 */
  let menuStockRows: MenuStockRow[] = [];
  let forecastResult: InventoryForecastData['result'] = null;
  let forecastWeekdayChart: WeekdayAvgPoint[] = [];
  let forecastUnit = '';
  let forecastSelectedName = '';
  let topForecast: InventoryForecastData['top'] = [];

  // 各タブの読み込みは lib/inventory-data-server.ts（iPad アプリのネイティブ画面と共用）
  if (tab === 'items') {
    const r = await loadInventoryItems(supabase, ctx.organizationId, currentStore.id, {
      kind: sp.kind,
      q: sp.q,
      sortWarning,
    });
    itemRows = r.rows;
    priceIncreaseItemIds = r.priceIncreaseItemIds;
  } else if (tab === 'counts') {
    countsData = await loadInventoryCounts(supabase, ctx.organizationId, currentStore.id);
  } else if (tab === 'transfers') {
    const r = await loadInventoryTransfers(supabase, ctx.organizationId, currentStore.id);
    transferRows = r.rows;
    transferItemOptions = r.itemOptions;
  } else if (tab === 'reorder') {
    reorderRows = await loadInventoryReorder(supabase, ctx.organizationId, currentStore.id);
  } else if (tab === 'menu') {
    // メニューの売り切り（本日の食数）。設定は店舗設定、売れた数はその日の伝票から数える
    const [{ data: items }, { data: cats }, stock] = await Promise.all([
      supabase
        .from('menu_items')
        .select('id, name, category_id, price, is_sold_out, status, store_id')
        .eq('organization_id', ctx.organizationId)
        .or(`store_id.is.null,store_id.eq.${currentStore.id}`)
        .eq('status', 'active')
        // 選択肢（オプション）はレジの商品一覧に出ないので、在庫の一覧にも出さない（2026-09-25 店舗要望）
        .neq('item_type', 'option')
        .order('sort_order')
        .order('name'),
      supabase
        .from('menu_categories')
        .select('id, name')
        .eq('organization_id', ctx.organizationId),
      loadMenuStock(supabase, currentStore.id),
    ]);
    const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
    menuStockRows = (items ?? []).map((m) => {
      const st = stock.get(m.id as string);
      return {
        id: m.id as string,
        name: m.name as string,
        categoryName: m.category_id ? (catName.get(m.category_id as string) ?? null) : null,
        price: Number(m.price ?? 0),
        limit: st ? st.limit : null,
        sold: st ? st.sold : 0,
        manualSoldOut: !!m.is_sold_out,
      };
    });
  } else if (tab === 'forecast') {
    const f = await loadInventoryForecast(supabase, ctx.organizationId, currentStore.id, sp.item);
    forecastItemOptions = f.itemOptions;
    forecastResult = f.result;
    forecastWeekdayChart = f.weekdayChart;
    forecastUnit = f.unit;
    forecastSelectedName = f.selectedName;
    topForecast = f.top;
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="総在庫金額" value={yen(totalStockValue)} tone="primary" />
            <StatCard label="要発注品目数" value={`${reorderCount}件`} tone={reorderCount > 0 ? 'warning' : 'default'} />
            <StatCard
              label="在庫切れ間近品目数"
              value={`${dangerCount}件`}
              tone={dangerCount > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="値上がり品目数"
              value={`${priceIncreaseItemIds.size}件`}
              tone={priceIncreaseItemIds.size > 0 ? 'danger' : 'default'}
              sub="前回仕入が前々回比10%以上値上がり"
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
          <ItemTable rows={itemRows} otherStores={otherStores} priceIncreaseItemIds={priceIncreaseItemIds} />
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

      {tab === 'menu' && (
        <div className="space-y-4">
          {/* レジ（iPad）で使う在庫管理の画面。左がカテゴリ・右が残り数（2026-09-25 店舗要望） */}
          <Link
            href="/app/inventory/menu-stock"
            className="tap3d flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 hover:bg-lilac-soft"
          >
            <span className="flex items-center gap-3">
              <Package className="h-5 w-5 shrink-0 text-royal" aria-hidden />
              <span>
                <span className="block text-[15px] font-bold text-navy">
                  在庫管理<span className="ml-1.5 text-[11px] font-semibold text-ink-3">Stock</span>
                </span>
                <span className="block text-[12px] text-ink-3">
                  カテゴリごとに、残りの数を指で入れる（レジのiPad向け・在庫印刷つき）
                </span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
          </Link>
          <MenuStockPanel storeId={currentStore.id} rows={menuStockRows} saveAction={setMenuStockLimit} />
        </div>
      )}

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
