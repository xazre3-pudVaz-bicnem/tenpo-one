'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import {
  transitionReservationStatus,
  markNoShow,
  cancelReservation,
  createOrderFromReservation,
} from '@/app/app/reservations/actions';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { RESERVATION_STATUS, RESERVATION_TRANSITIONS, type ReservationStatus } from '@/lib/reservations';
import { cn } from '@/lib/utils';

const FORWARD_VARIANT: Partial<Record<ReservationStatus, NonNullable<ButtonProps['variant']>>> = {
  waiting: 'secondary',
  arrived: 'secondary',
  seated: 'success',
  billing: 'primary',
  completed: 'navy',
};

/**
 * 予約カード・詳細ダイアログ共通のステータス操作ボタン群。
 * lib/reservations.ts の RESERVATION_TRANSITIONS から「次に進める遷移だけ」を算出して表示する。
 */
export function StatusActions({
  reservationId,
  status,
  size = 'sm',
  className,
}: {
  reservationId: string;
  status: ReservationStatus;
  size?: 'sm' | 'md';
  className?: string;
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

  const nextStatuses = RESERVATION_TRANSITIONS[status] ?? [];
  const forward = nextStatuses.filter((s) => s !== 'cancelled' && s !== 'no_show');
  const canCancel = nextStatuses.includes('cancelled');
  const canNoShow = nextStatuses.includes('no_show');
  const btnClass = size === 'sm' ? 'h-7 px-2 text-xs' : undefined;

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {forward.map((next) => (
        <Button
          key={next}
          size={size}
          variant={FORWARD_VARIANT[next] ?? 'secondary'}
          disabled={pending}
          onClick={() => run(() => transitionReservationStatus(reservationId, next), `「${RESERVATION_STATUS[next].label}」にしました`)}
          className={btnClass}
        >
          {RESERVATION_STATUS[next].label}
        </Button>
      ))}
      {(status === 'seated' || status === 'billing') && (
        <Button size={size} variant="navy" disabled={pending} onClick={() => run(() => createOrderFromReservation(reservationId))} className={btnClass}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          注文へ
        </Button>
      )}
      {canNoShow && (
        <Button size={size} variant="secondary" disabled={pending} onClick={() => setConfirmKind('no_show')} className={btnClass}>
          無断キャンセル
        </Button>
      )}
      {canCancel && (
        <Button size={size} variant="danger" disabled={pending} onClick={() => setConfirmKind('cancel')} className={btnClass}>
          キャンセル
        </Button>
      )}

      <ConfirmDialog
        open={confirmKind === 'no_show'}
        onClose={() => setConfirmKind(null)}
        title="無断キャンセルとして記録"
        message="この予約を「無断キャンセル」として記録します。よろしいですか？"
        confirmLabel="記録する"
        requireReason={false}
        onConfirm={(reason) => run(() => markNoShow(reservationId, reason || undefined), '無断キャンセルを記録しました')}
      />
      <ConfirmDialog
        open={confirmKind === 'cancel'}
        onClose={() => setConfirmKind(null)}
        title="予約をキャンセル"
        message="この予約をキャンセルします。"
        confirmLabel="キャンセルする"
        requireReason
        onConfirm={(reason) => run(() => cancelReservation(reservationId, reason), 'キャンセルしました')}
      />
    </div>
  );
}
