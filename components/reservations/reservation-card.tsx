'use client';

import { useState, useTransition } from 'react';
import { Users, ArrowRight, UserX, Loader2 } from 'lucide-react';
import { assignTable, setSeated, markNoShow, cancelReservation, createOrderFromReservation } from '@/app/app/reservations/actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_BADGE_TONE, type ReservationStatus } from './status';

export interface ReservationCardData {
  id: string;
  guestName: string;
  partySize: number;
  startAt: string;
  endAt: string;
  status: ReservationStatus;
  assignedTableId: string | null;
  memo?: string | null;
}

const SEATABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];
const NO_SHOWABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];
const CANCELLABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted'];
const ASSIGNABLE: ReservationStatus[] = ['pending', 'confirmed', 'waitlisted', 'seated'];

export function ReservationCard({
  reservation,
  tables,
  variant = 'grid',
}: {
  reservation: ReservationCardData;
  tables: { id: string; name: string }[];
  variant?: 'grid' | 'list';
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmKind, setConfirmKind] = useState<'no_show' | 'cancel' | null>(null);

  const run = (fn: () => Promise<void>, successMessage?: string) => {
    startTransition(async () => {
      try {
        await fn();
        if (successMessage) toast(successMessage);
      } catch (e) {
        toast(e instanceof Error ? e.message : '処理に失敗しました', 'error');
      }
    });
  };

  const compact = variant === 'grid';

  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-sm',
        compact ? 'min-w-[9rem]' : 'p-3 text-sm'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-navy tabular-nums">
          {formatTime(reservation.startAt)}〜{formatTime(reservation.endAt)}
        </span>
        <Badge tone={STATUS_BADGE_TONE[reservation.status]}>{STATUS_LABEL[reservation.status]}</Badge>
      </div>
      <p className="mt-1 truncate font-medium text-navy">{reservation.guestName} 様</p>
      <p className="flex items-center gap-1 text-gray-500">
        <Users className="h-3.5 w-3.5" />
        {reservation.partySize}名
      </p>

      {ASSIGNABLE.includes(reservation.status) && (
        <select
          aria-label="テーブル割当"
          value={reservation.assignedTableId ?? ''}
          disabled={pending}
          onChange={(e) => run(() => assignTable(reservation.id, e.target.value || null))}
          className="mt-2 h-8 w-full rounded-md border border-gray-300 bg-white px-1.5 text-xs"
        >
          <option value="">未割当</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      <div className={cn('mt-2 flex flex-wrap gap-1', compact && 'flex-col')}>
        {SEATABLE.includes(reservation.status) && (
          <Button
            size="sm"
            variant="success"
            disabled={pending || !reservation.assignedTableId}
            title={!reservation.assignedTableId ? '先にテーブルを割り当ててください' : undefined}
            onClick={() => run(() => setSeated(reservation.id), '着席にしました')}
            className="h-7 px-2 text-xs"
          >
            着席
          </Button>
        )}
        {reservation.status === 'seated' && (
          <Button
            size="sm"
            variant="navy"
            disabled={pending}
            onClick={() => run(() => createOrderFromReservation(reservation.id))}
            className="h-7 px-2 text-xs"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            注文へ
          </Button>
        )}
        {NO_SHOWABLE.includes(reservation.status) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirmKind('no_show')}
            className="h-7 px-2 text-xs"
          >
            <UserX className="h-3.5 w-3.5" />
            来店なし
          </Button>
        )}
        {CANCELLABLE.includes(reservation.status) && (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirmKind('cancel')} className="h-7 px-2 text-xs">
            キャンセル
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmKind === 'no_show'}
        onClose={() => setConfirmKind(null)}
        title="来店なしとして記録"
        message={`${reservation.guestName} 様の予約を「来店なし」として記録します。よろしいですか？`}
        confirmLabel="記録する"
        requireReason={false}
        onConfirm={(reason) => run(() => markNoShow(reservation.id, reason || undefined), '来店なしを記録しました')}
      />
      <ConfirmDialog
        open={confirmKind === 'cancel'}
        onClose={() => setConfirmKind(null)}
        title="予約をキャンセル"
        message={`${reservation.guestName} 様の予約をキャンセルします。`}
        confirmLabel="キャンセルする"
        requireReason
        onConfirm={(reason) => run(() => cancelReservation(reservation.id, reason), 'キャンセルしました')}
      />
    </div>
  );
}
