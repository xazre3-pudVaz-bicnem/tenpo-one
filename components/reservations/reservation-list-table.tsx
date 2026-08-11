'use client';

import { useState } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { formatDate, formatTime } from '@/lib/format';
import { RESERVATION_STATUS } from '@/lib/reservations';
import { CREATED_VIA_LABEL } from './constants';
import { ReservationDetailDialog } from './reservation-detail-dialog';
import type { AssignableTable } from './assign-table-dialog';
import type { ReservationListRow } from './list-types';

export function ReservationListTable({
  reservations,
  showStore,
  storeAssignableTables,
  staffByStore,
  canManagePrivateHire,
}: {
  reservations: ReservationListRow[];
  showStore: boolean;
  storeAssignableTables: Record<string, AssignableTable[]>;
  staffByStore: Record<string, { id: string; name: string }[]>;
  canManagePrivateHire: boolean;
}) {
  const [selected, setSelected] = useState<ReservationListRow | null>(null);

  if (reservations.length === 0) {
    return <EmptyState title="該当する予約がありません" description="検索条件を変更して再度お試しください。" />;
  }

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>予約日</Th>
              <Th>時間</Th>
              <Th>氏名</Th>
              <Th className="text-right">人数</Th>
              <Th>予約内容</Th>
              {showStore && <Th>店舗</Th>}
              <Th>担当者</Th>
              <Th>経路</Th>
              <Th>登録方法</Th>
              <Th>状態</Th>
              <Th>テーブル</Th>
            </Tr>
          </THead>
          <TBody>
            {reservations.map((r) => (
              <Tr key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                <Td>{formatDate(r.reservedDate)}</Td>
                <Td className="tabular-nums">{formatTime(r.startAt)}</Td>
                <Td className="font-medium text-navy">
                  <span className="flex items-center gap-1.5">
                    {r.guestName} 様
                    {r.isPrivateHire && <Badge tone="primary">貸切</Badge>}
                  </span>
                  <div className="text-xs text-gray-400">{r.guestPhone}</div>
                </Td>
                <Td className="text-right tabular-nums">{r.partySize}名</Td>
                <Td>
                  {r.courseName ? (
                    <span className="text-navy">{r.courseName}</span>
                  ) : (
                    <span className="text-gray-500">席のみ</span>
                  )}
                </Td>
                {showStore && <Td>{r.storeName ?? '—'}</Td>}
                <Td>{r.staffName ?? '—'}</Td>
                <Td>{r.sourceName ?? '—'}</Td>
                <Td>{CREATED_VIA_LABEL[r.createdVia] ?? r.createdVia}</Td>
                <Td>
                  <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge>
                </Td>
                <Td>{r.tableNames.length > 0 ? r.tableNames.join('、') : '未割当'}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ReservationDetailDialog
        reservation={selected}
        onClose={() => setSelected(null)}
        tables={selected ? (storeAssignableTables[selected.storeId] ?? []) : []}
        staffOptions={selected ? (staffByStore[selected.storeId] ?? []) : []}
        canManagePrivateHire={canManagePrivateHire}
      />
    </>
  );
}
