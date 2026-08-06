import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { ItemForm } from '@/components/inventory/item-form';
import { ItemTable, type ItemRow } from '@/components/inventory/item-table';
import { StartCountButton } from '@/components/inventory/start-count-button';
import {
  ITEM_KIND_LABELS,
  ITEM_KIND_OPTIONS,
  COUNT_STATUS_LABELS,
  COUNT_STATUS_TONES,
  type ItemKind,
  type CountStatus,
} from '@/components/inventory/labels';

export const metadata: Metadata = { title: '在庫' };

type Tab = 'items' | 'counts';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; kind?: string; q?: string }>;
}) {
  const ctx = await requireMember();
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'counts' ? 'counts' : 'items';

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
      avgCost: i.avg_cost,
    }));
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
            <Button type="submit" variant="secondary">
              絞り込む
            </Button>
          </form>
          <ItemTable rows={itemRows} />
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
