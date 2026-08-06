import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { yen, formatDate } from '@/lib/format';
import { PO_STATUS_LABELS, PO_STATUS_TONES, type PoStatus } from '@/components/inventory/labels';
import { ReceiveForm } from '@/components/inventory/receive-form';
import { PoStatusActions } from './po-status-actions';

export const metadata: Metadata = { title: '発注詳細' };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  const { id } = await params;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*, vendors(name), stores(name)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!po) notFound();

  const { data: itemsData } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', id)
    .order('created_at');
  const items = itemsData ?? [];

  const status = po.status as PoStatus;
  const vendorName = (po.vendors as unknown as { name: string } | null)?.name ?? '';
  const storeName = (po.stores as unknown as { name: string } | null)?.name ?? '';

  return (
    <div>
      <PageHeader
        title={`発注書 #${po.po_no}`}
        description={`${vendorName}／${storeName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(status === 'ordered' || status === 'partially_received') && (
              <ReceiveForm
                poId={po.id}
                items={items.map((i) => ({
                  id: i.id,
                  name: i.name,
                  unit: i.unit,
                  quantity: Number(i.quantity),
                  receivedQuantity: Number(i.received_quantity),
                }))}
              />
            )}
            <PoStatusActions poId={po.id} status={status} />
          </div>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-gray-500">状態</p>
          <div className="mt-1">
            <Badge tone={PO_STATUS_TONES[status]}>{PO_STATUS_LABELS[status]}</Badge>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">合計金額</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(po.total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">入荷予定日</p>
          <p className="mt-1 text-sm text-navy">{formatDate(po.expected_at)}</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>品目</Th>
                  <Th className="text-right">数量</Th>
                  <Th>単位</Th>
                  <Th className="text-right">単価</Th>
                  <Th className="text-right">金額</Th>
                  <Th className="text-right">入荷済み</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((i) => (
                  <Tr key={i.id}>
                    <Td className="font-medium text-navy">{i.name}</Td>
                    <Td className="text-right tabular-nums">{i.quantity}</Td>
                    <Td>{i.unit}</Td>
                    <Td className="text-right tabular-nums">{yen(i.unit_cost)}</Td>
                    <Td className="text-right tabular-nums">{yen(Math.round(i.quantity * i.unit_cost))}</Td>
                    <Td className="text-right tabular-nums">
                      {i.received_quantity} / {i.quantity}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>

      {po.note && (
        <Card className="mt-5 p-4">
          <p className="text-xs text-gray-500">メモ</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{po.note}</p>
        </Card>
      )}
    </div>
  );
}
