'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RESERVATION_STATUS } from '@/lib/reservations';
import { StatusActions } from './status-actions';
import { AssignTableDialog, type AssignableTable } from './assign-table-dialog';
import { MoveDialog } from './move-dialog';
import { ReservationDetailDialog } from './reservation-detail-dialog';
import { ASSIGNABLE_STATUSES, MOVABLE_STATUSES } from './constants';
import type { ReservationListRow } from './list-types';

export type ReservationCardData = ReservationListRow;

export function ReservationCard({
  reservation,
  tables,
  staffOptions,
  canManagePrivateHire,
  variant = 'grid',
}: {
  reservation: ReservationCardData;
  tables: AssignableTable[];
  staffOptions: { id: string; name: string }[];
  canManagePrivateHire: boolean;
  variant?: 'grid' | 'list';
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const compact = variant === 'grid';

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-2 text-xs shadow-sm',
        reservation.isPrivateHire ? 'border-primary' : 'border-gray-200',
        compact ? 'min-w-[9.5rem]' : 'p-3 text-sm'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-navy tabular-nums">
          {formatTime(reservation.startAt)}〜{formatTime(reservation.endAt)}
        </span>
        <Badge tone={RESERVATION_STATUS[reservation.status].tone}>{RESERVATION_STATUS[reservation.status].label}</Badge>
      </div>
      {reservation.isPrivateHire && (
        <Badge tone="primary" className="mt-1">
          貸切
        </Badge>
      )}
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        className="mt-1 block truncate text-left font-medium text-navy hover:underline"
      >
        {reservation.guestName} 様
      </button>
      <p className="flex items-center gap-1 text-gray-500">
        <Users className="h-3.5 w-3.5" />
        {reservation.partySize}名
        {reservation.staffName && <span className="ml-1 truncate text-gray-400">／{reservation.staffName}</span>}
      </p>
      {reservation.tableNames.length > 0 && <p className="truncate text-gray-400">{reservation.tableNames.join('＋')}</p>}

      <div className={cn('mt-2 flex flex-wrap gap-1', compact && 'flex-col items-stretch')}>
        <StatusActions reservationId={reservation.id} status={reservation.status} />
        {ASSIGNABLE_STATUSES.includes(reservation.status) && (
          <AssignTableDialog
            reservationId={reservation.id}
            storeId={reservation.storeId}
            partySize={reservation.partySize}
            startAt={reservation.startAt}
            endAt={reservation.endAt}
            currentTableIds={reservation.tableIds}
            tables={tables}
          />
        )}
        {MOVABLE_STATUSES.includes(reservation.status) && (
          <MoveDialog reservationId={reservation.id} startAt={reservation.startAt} endAt={reservation.endAt} />
        )}
      </div>

      <ReservationDetailDialog
        reservation={detailOpen ? reservation : null}
        onClose={() => setDetailOpen(false)}
        tables={tables}
        staffOptions={staffOptions}
        canManagePrivateHire={canManagePrivateHire}
      />
    </div>
  );
}
