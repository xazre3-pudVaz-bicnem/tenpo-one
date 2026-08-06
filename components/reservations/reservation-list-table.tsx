'use client';

import { useState } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { formatDate, formatTime } from '@/lib/format';
import { STATUS_LABEL, STATUS_BADGE_TONE, CREATED_VIA_LABEL } from './status';
import { ReservationDetailDialog } from './reservation-detail-dialog';
import type { ReservationListRow } from './list-types';

export function ReservationListTable({ reservations, showStore }: { reservations: ReservationListRow[]; showStore: boolean }) {
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
              {showStore && <Th>店舗</Th>}
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
                  {r.guestName} 様
                  <div className="text-xs text-gray-400">{r.guestPhone}</div>
                </Td>
                <Td className="text-right tabular-nums">{r.partySize}名</Td>
                {showStore && <Td>{r.storeName ?? '—'}</Td>}
                <Td>{r.sourceName ?? '—'}</Td>
                <Td>{CREATED_VIA_LABEL[r.createdVia] ?? r.createdVia}</Td>
                <Td>
                  <Badge tone={STATUS_BADGE_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </Td>
                <Td>{r.tableNames.length > 0 ? r.tableNames.join('、') : '未割当'}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ReservationDetailDialog reservation={selected} onClose={() => setSelected(null)} />
    </>
  );
}
