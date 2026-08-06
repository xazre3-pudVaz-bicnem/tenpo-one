import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { yen, formatDate } from '@/lib/format';
import { PO_STATUS_LABELS, PO_STATUS_TONES, PO_STATUS_OPTIONS, type PoStatus } from '@/components/inventory/labels';

export const metadata: Metadata = { title: '発注' };

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireMember();
  const supabase = await createClient();
  const sp = await searchParams;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  let query = supabase
    .from('purchase_orders')
    .select('id, po_no, status, total, expected_at, vendors(name), stores(name)')
    .eq('organization_id', ctx.organizationId)
    .in('store_id', storeIds.length > 0 ? storeIds : ['00000000-0000-0000-0000-000000000000']);
  if (sp.status) query = query.eq('status', sp.status);
  const { data } = await query.order('created_at', { ascending: false }).limit(300);
  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="発注"
        description="仕入先への発注状況・入荷を管理します"
        actions={
          <Link href="/app/purchases/new">
            <Button>発注書を作成</Button>
          </Link>
        }
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">状態</label>
          <Select name="status" defaultValue={sp.status ?? ''} className="w-40">
            <option value="">すべて</option>
            {PO_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PO_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          絞り込む
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="発注書がありません" description="「発注書を作成」から新しい発注を作成してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>発注番号</Th>
                <Th>仕入先</Th>
                <Th>店舗</Th>
                <Th className="text-right">金額</Th>
                <Th>状態</Th>
                <Th>入荷予定</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/purchases/${r.id}`} className="font-medium text-primary hover:underline">
                      #{r.po_no}
                    </Link>
                  </Td>
                  <Td>{(r.vendors as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td>{(r.stores as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{yen(r.total)}</Td>
                  <Td>
                    <Badge tone={PO_STATUS_TONES[r.status as PoStatus]}>{PO_STATUS_LABELS[r.status as PoStatus]}</Badge>
                  </Td>
                  <Td>{formatDate(r.expected_at)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
