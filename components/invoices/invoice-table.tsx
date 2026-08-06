'use client';

import { useState } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { yen, formatDate, todayJst } from '@/lib/format';
import { InvoiceDetailDialog } from './invoice-detail';
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES, type InvoiceStatus } from './labels';

export interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
  vendorName: string;
  dueDate: string | null;
  amount: number;
  storeName: string | null;
}

const OPEN_STATUSES: InvoiceStatus[] = ['open', 'review', 'approved', 'scheduled'];

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayJst();

  if (rows.length === 0) {
    return (
      <EmptyState
        title="該当する請求書はありません"
        description="絞り込み条件を変更するか、新しい請求書を登録してください"
      />
    );
  }

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>状態</Th>
              <Th>取引先</Th>
              <Th>支払期限</Th>
              <Th className="text-right">金額</Th>
              <Th>店舗</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const overdue = !!r.dueDate && r.dueDate < today && OPEN_STATUSES.includes(r.status);
              return (
                <Tr key={r.id} className="cursor-pointer" onClick={() => setSelected(r.id)}>
                  <Td>
                    <Badge tone={INVOICE_STATUS_TONES[r.status]}>{INVOICE_STATUS_LABELS[r.status]}</Badge>
                  </Td>
                  <Td className="font-medium text-navy">{r.vendorName}</Td>
                  <Td className={overdue ? 'font-semibold text-danger' : ''}>{formatDate(r.dueDate)}</Td>
                  <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                  <Td>{r.storeName ?? '全店舗'}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>
      <InvoiceDetailDialog key={selected ?? 'closed'} invoiceId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
