'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { formatDate, formatTime, yen } from '@/lib/format';
import { updateReservationMemo } from '@/app/app/reservations/actions';
import { STATUS_LABEL, STATUS_BADGE_TONE, CREATED_VIA_LABEL } from './status';
import type { ReservationListRow } from './list-types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return value ? (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-navy">{value}</dd>
    </div>
  ) : null;
}

export function ReservationDetailDialog({
  reservation,
  onClose,
}: {
  reservation: ReservationListRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const [memo, setMemo] = useState(reservation?.memo ?? '');
  const [pending, startTransition] = useTransition();
  const [prepay, setPrepay] = useState<{ reservationId: string; amount: number } | null>(null);

  useEffect(() => {
    if (!reservation) return;
    const reservationId = reservation.id;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('payment_intents')
        .select('amount')
        .eq('reservation_id', reservationId)
        .in('purpose', ['booking_prepay', 'booking_deposit'])
        .eq('status', 'succeeded')
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setPrepay(data ? { reservationId, amount: data.amount } : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reservation, supabase]);

  const activePrepay = reservation && prepay?.reservationId === reservation.id ? prepay : null;

  if (!reservation) return null;

  const save = () => {
    startTransition(async () => {
      try {
        await updateReservationMemo(reservation.id, memo);
        toast('内部メモを更新しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open={!!reservation} onClose={onClose} title="予約詳細" wide>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-bold tracking-wider text-primary-deep tabular-nums">{reservation.code}</span>
        <div className="flex items-center gap-2">
          {activePrepay && <Badge tone="success">事前決済済み {yen(activePrepay.amount)}</Badge>}
          <Badge tone={STATUS_BADGE_TONE[reservation.status]}>{STATUS_LABEL[reservation.status]}</Badge>
        </div>
      </div>
      <dl>
        <Row label="日時" value={`${formatDate(reservation.reservedDate)} ${formatTime(reservation.startAt)}〜${formatTime(reservation.endAt)}`} />
        <Row label="人数" value={`${reservation.partySize}名（大人${reservation.adults}・子ども${reservation.children}）`} />
        <Row label="お名前" value={`${reservation.guestName} 様`} />
        <Row label="フリガナ" value={reservation.guestNameKana} />
        <Row label="電話番号" value={reservation.guestPhone} />
        <Row label="メール" value={reservation.guestEmail} />
        <Row label="コース" value={reservation.courseName} />
        <Row label="席の希望" value={reservation.seatType} />
        <Row label="利用目的" value={reservation.purpose} />
        <Row label="アレルギー" value={reservation.allergyNote} />
        <Row label="お客様のご要望" value={reservation.requestNote} />
        <Row label="割当テーブル" value={reservation.tableNames.length > 0 ? reservation.tableNames.join('、') : '未割当'} />
        <Row label="経路" value={reservation.sourceName} />
        <Row label="登録方法" value={CREATED_VIA_LABEL[reservation.createdVia] ?? reservation.createdVia} />
        {reservation.storeName && <Row label="店舗" value={reservation.storeName} />}
      </dl>

      <div className="mt-4">
        <Label htmlFor="detail-memo">内部メモ（店舗スタッフのみ表示）</Label>
        <Textarea id="detail-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={save} disabled={pending}>
            メモを保存
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
