import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { yen, formatDate } from '@/lib/format';
import { PO_STATUS_LABELS, PO_STATUS_TONES, PO_STATUS_OPTIONS, type PoStatus } from '@/components/inventory/labels';

export const metadata: Metadata = { title: '発注' };

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; vendor?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireFeature('inventory');
  const supabase = await createClient();
  const sp = await searchParams;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data: vendorsData } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('name');
  const vendors = vendorsData ?? [];

  let query = supabase
    .from('purchase_orders')
    .select('id, po_no, status, total, expected_at, requested_by, created_at, vendors(name), stores(name)')
    .eq('organization_id', ctx.organizationId)
    .in('store_id', storeIds.length > 0 ? storeIds : ['00000000-0000-0000-0000-000000000000']);
  if (sp.status) query = query.eq('status', sp.status);
  if (sp.vendor) query = query.eq('vendor_id', sp.vendor);
  if (sp.from) query = query.gte('created_at', `${sp.from}T00:00:00+09:00`);
  if (sp.to) query = query.lte('created_at', `${sp.to}T23:59:59+09:00`);
  const { data } = await query.order('created_at', { ascending: false }).limit(300);
  const rows = data ?? [];

  const requesterIds = [...new Set(rows.map((r) => r.requested_by).filter((v): v is string => !!v))];
  let requesterNames = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', requesterIds);
    requesterNames = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  }

  const exportQuery = new URLSearchParams();
  if (sp.status) exportQuery.set('status', sp.status);
  if (sp.from) exportQuery.set('from', sp.from);
  if (sp.to) exportQuery.set('to', sp.to);
  if (ctx.currentStore) exportQuery.set('store', ctx.currentStore.id);

  return (
    <div>
      <PageHeader
        title="発注"
        description="仕入先への発注状況・入荷を管理します"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can(ctx.role, 'csv.export') && (
              <a href={`/app/purchases/export?${exportQuery.toString()}`} className={buttonVariants({ variant: 'secondary' })}>
                CSV出力
              </a>
            )}
            <Link href="/app/purchases/new">
              <Button>発注書を作成</Button>
            </Link>
          </div>
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
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">仕入先</label>
          <Select name="vendor" defaultValue={sp.vendor ?? ''} className="w-48">
            <option value="">すべて</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">発注日（開始）</label>
          <Input name="from" type="date" defaultValue={sp.from ?? ''} className="w-40" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">発注日（終了）</label>
          <Input name="to" type="date" defaultValue={sp.to ?? ''} className="w-40" />
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
                <Th>状態</Th>
                <Th>仕入先</Th>
                <Th>店舗</Th>
                <Th>希望納期</Th>
                <Th>担当者</Th>
                <Th className="text-right">金額</Th>
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
                  <Td>
                    <Badge tone={PO_STATUS_TONES[r.status as PoStatus]}>{PO_STATUS_LABELS[r.status as PoStatus]}</Badge>
                  </Td>
                  <Td>{(r.vendors as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td>{(r.stores as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td>{formatDate(r.expected_at)}</Td>
                  <Td>{r.requested_by ? (requesterNames.get(r.requested_by) ?? '—') : '—'}</Td>
                  <Td className="text-right tabular-nums">{yen(r.total)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
