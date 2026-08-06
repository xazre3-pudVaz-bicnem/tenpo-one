import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { COUNT_STATUS_LABELS, COUNT_STATUS_TONES, type CountStatus } from '@/components/inventory/labels';
import { CountForm, type CountItemRow } from '@/components/inventory/count-form';

export const metadata: Metadata = { title: '棚卸' };

export default async function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  const supabase = await createClient();

  const { data: count } = await supabase
    .from('stock_counts')
    .select('*, stores(name)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!count) notFound();

  const { data: itemsData } = await supabase
    .from('stock_count_items')
    .select('*, inventory_items(name, unit)')
    .eq('stock_count_id', id);

  const items: CountItemRow[] = (itemsData ?? [])
    .map((i) => {
      const inv = i.inventory_items as unknown as { name: string; unit: string } | null;
      return {
        id: i.id as string,
        name: inv?.name ?? '不明な品目',
        unit: inv?.unit ?? '',
        expectedQuantity: Number(i.expected_quantity),
        countedQuantity: i.counted_quantity != null ? Number(i.counted_quantity) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const status = count.status as CountStatus;
  const storeName = (count.stores as unknown as { name: string } | null)?.name ?? '';

  return (
    <div>
      <PageHeader
        title={`棚卸：${formatDate(count.count_date)}`}
        description={storeName}
        actions={<Badge tone={COUNT_STATUS_TONES[status]}>{COUNT_STATUS_LABELS[status]}</Badge>}
      />

      {status === 'draft' ? (
        <CountForm countId={count.id} items={items} />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>品目</Th>
                <Th className="text-right">理論在庫</Th>
                <Th className="text-right">実数</Th>
                <Th className="text-right">差異</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((i) => {
                const diff = i.countedQuantity != null ? i.countedQuantity - i.expectedQuantity : null;
                return (
                  <Tr key={i.id}>
                    <Td className="font-medium text-navy">{i.name}</Td>
                    <Td className="text-right tabular-nums">
                      {i.expectedQuantity}
                      {i.unit}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {i.countedQuantity ?? '—'}
                      {i.countedQuantity != null ? i.unit : ''}
                    </Td>
                    <Td
                      className={`text-right tabular-nums ${
                        diff != null && diff !== 0 ? (diff > 0 ? 'text-success' : 'text-danger') : ''
                      }`}
                    >
                      {diff != null ? `${diff > 0 ? '+' : ''}${diff}${i.unit}` : '—'}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
