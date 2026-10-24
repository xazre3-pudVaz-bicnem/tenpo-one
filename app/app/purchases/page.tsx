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
import { PO_STATUS_LABELS, PO_STATUS_TONES, PO_STATUS_OPTIONS } from '@/components/inventory/labels';
import { loadPurchaseOrderRows } from '@/lib/purchasing-data-server';

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

  // 読み込みは lib/purchasing-data-server.ts（iPad アプリのネイティブ画面と共用）
  const { rows, vendors } = await loadPurchaseOrderRows(supabase, ctx.organizationId ?? '', storeIds, sp);

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
                      #{r.poNo}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={PO_STATUS_TONES[r.status]}>{PO_STATUS_LABELS[r.status]}</Badge>
                  </Td>
                  <Td>{r.vendorName ?? '—'}</Td>
                  <Td>{r.storeName ?? '—'}</Td>
                  <Td>{formatDate(r.expectedAt)}</Td>
                  <Td>{r.requesterName ?? '—'}</Td>
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
