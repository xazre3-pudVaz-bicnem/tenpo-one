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
import { yen, formatDate } from '@/lib/format';
import { ItemForm } from '@/components/inventory/item-form';
import { ItemTable, type ItemRow } from '@/components/inventory/item-table';
import { StartCountButton } from '@/components/inventory/start-count-button';
import {
  ITEM_KIND_LABELS,
  ITEM_KIND_OPTIONS,
  COUNT_STATUS_LABELS,
  COUNT_STATUS_TONES,
  stockWarningLevel,
  type ItemKind,
  type CountStatus,
} from '@/components/inventory/labels';

export const metadata: Metadata = { title: '在庫' };

type Tab = 'items' | 'counts';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; kind?: string; q?: string; sort?: string }>;
}) {
  const ctx = await requireFeature('inventory');
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'counts' ? 'counts' : 'items';
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

  const supabase = await createClient();
  let itemRows: ItemRow[] = [];
  let countsData: { id: string; countDate: string; status: CountStatus }[] = [];

  if (tab === 'items') {
    let q = supabase
      .from('inventory_items')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', ctx.currentStore.id)
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
  } else {
    const { data } = await supabase
      .from('stock_counts')
      .select('id, count_date, status')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', ctx.currentStore.id)
      .order('count_date', { ascending: false })
      .limit(100);
    countsData = (data ?? []).map((c) => ({ id: c.id, countDate: c.count_date, status: c.status as CountStatus }));
  }

  const otherStores = ctx.stores.filter((s) => s.id !== ctx.currentStore!.id).map((s) => ({ id: s.id, name: s.name }));

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
        description={`店舗: ${ctx.currentStore.name}`}
        actions={tab === 'items' ? <ItemForm storeId={ctx.currentStore.id} /> : <StartCountButton storeId={ctx.currentStore.id} />}
      />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {[
          { key: 'items', label: '品目' },
          { key: 'counts', label: '棚卸' },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/inventory?tab=${t.key}`}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
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
    </div>
  );
}
