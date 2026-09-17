'use client';

import { useState } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { formatDate, formatTime } from '@/lib/format';
import { RESERVATION_STATUS } from '@/lib/reservations';
import { cn } from '@/lib/utils';
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
  embedded,
}: {
  reservations: ReservationListRow[];
  showStore: boolean;
  storeAssignableTables: Record<string, AssignableTable[]>;
  staffByStore: Record<string, { id: string; name: string }[]>;
  canManagePrivateHire: boolean;
  /** カード内に置くとき true（枠線・影を付けない） */
  embedded?: boolean;
}) {
  const [selected, setSelected] = useState<ReservationListRow | null>(null);

  if (reservations.length === 0) {
    return (
      <EmptyState
        title="該当するご予約はありません"
        description="日付や絞り込み条件を変更して再度お試しください。"
        className={embedded ? 'm-4 border-line bg-lilac-soft py-10' : undefined}
      />
    );
  }

  return (
    <>
      <TableWrap className={embedded ? 'rounded-none border-0 shadow-none' : undefined}>
        <Table>
          <THead>
            <Tr>
              <Th>予約日</Th>
              <Th>時間</Th>
              <Th>お名前</Th>
              <Th className="text-right">人数</Th>
              <Th>テーブル</Th>
              <Th>予約内容</Th>
              {showStore && <Th>店舗</Th>}
              <Th>担当者</Th>
              <Th>受付</Th>
              <Th>状態</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {reservations.map((r) => {
              const dim = r.status === 'completed' || r.status === 'cancelled' || r.status === 'no_show';
              return (
                <Tr key={r.id} className={cn('cursor-pointer', dim && 'text-ink-3')} onClick={() => setSelected(r)}>
                  <Td className="text-ink-2 tabular-nums">{formatDate(r.reservedDate)}</Td>
                  <Td className="tabular-nums">
                    <span className={cn('font-bold', dim ? 'text-ink-3' : 'text-royal')}>{formatTime(r.startAt)}</span>
                    <span className="block text-xs font-medium text-ink-3">〜{formatTime(r.endAt)}</span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5 font-bold text-ink">
                      {r.guestName} 様
                      {r.isPrivateHire && <Badge tone="primary">貸切</Badge>}
                    </span>
                    <span className="block text-xs text-ink-3 tabular-nums">{r.guestPhone}</span>
                  </Td>
                  <Td className="text-right font-bold tabular-nums">{r.partySize}名</Td>
                  <Td>
                    {r.tableNames.length > 0 ? (
                      <span className="font-bold text-ink">{r.tableNames.join(' + ')}</span>
                    ) : (
                      <span className="text-xs font-bold text-danger">席未定</span>
                    )}
                  </Td>
                  <Td>{r.courseName ? <span className="text-ink">{r.courseName}</span> : <span className="text-ink-3">席のみ</span>}</Td>
                  {showStore && <Td>{r.storeName ?? '—'}</Td>}
                  <Td>{r.staffName ?? '—'}</Td>
                  <Td>
                    <span className="block text-ink-2">{r.sourceName ?? '—'}</span>
                    <span className="block text-xs text-ink-3">{CREATED_VIA_LABEL[r.createdVia] ?? r.createdVia}</span>
                  </Td>
                  <Td>
                    <Badge tone={RESERVATION_STATUS[r.status].tone} className="font-bold">
                      {RESERVATION_STATUS[r.status].label}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <span className="rounded-lg border border-wisteria bg-white px-2.5 py-1 text-xs font-bold text-royal">詳細</span>
                  </Td>
                </Tr>
              );
            })}
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
