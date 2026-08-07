'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { formatDate, formatTime, formatMinutes, yen } from '@/lib/format';
import { RESERVATION_STATUS } from '@/lib/reservations';
import {
  updateReservationMemo,
  updateReservationDetails,
  updateReservationStaff,
  updateReservationPrivateHire,
} from '@/app/app/reservations/actions';
import { CREATED_VIA_LABEL, ASSIGNABLE_STATUSES, MOVABLE_STATUSES } from './constants';
import { StatusActions } from './status-actions';
import { AssignTableDialog, type AssignableTable } from './assign-table-dialog';
import { MoveDialog } from './move-dialog';
import type { ReservationListRow } from './list-types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return value ? (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-navy">{value}</dd>
    </div>
  ) : null;
}

/**
 * 予約詳細ダイアログ。reservation.id をキーに毎回フレッシュな内部状態で再マウントする
 * （別の予約を選び直した際にメモ・担当者などの入力状態が前の予約のまま残らないようにするため）。
 */
export function ReservationDetailDialog({
  reservation,
  onClose,
  tables,
  staffOptions,
  canManagePrivateHire,
}: {
  reservation: ReservationListRow | null;
  onClose: () => void;
  tables: AssignableTable[];
  staffOptions: { id: string; name: string }[];
  canManagePrivateHire: boolean;
}) {
  if (!reservation) return null;
  return (
    <ReservationDetailDialogContent
      key={reservation.id}
      reservation={reservation}
      onClose={onClose}
      tables={tables}
      staffOptions={staffOptions}
      canManagePrivateHire={canManagePrivateHire}
    />
  );
}

function ReservationDetailDialogContent({
  reservation,
  onClose,
  tables,
  staffOptions,
  canManagePrivateHire,
}: {
  reservation: ReservationListRow;
  onClose: () => void;
  tables: AssignableTable[];
  staffOptions: { id: string; name: string }[];
  canManagePrivateHire: boolean;
}) {
  const { toast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const [memo, setMemo] = useState(reservation.memo ?? '');
  const [memoPending, startMemoTransition] = useTransition();
  const [staffId, setStaffId] = useState(reservation.staffId ?? '');
  const [staffPending, startStaffTransition] = useTransition();
  const [privateHire, setPrivateHire] = useState(reservation.isPrivateHire);
  const [privatePending, startPrivateTransition] = useTransition();
  const [prepay, setPrepay] = useState<{ amount: number } | null>(null);
  const [details, setDetails] = useState({
    adults: reservation.adults,
    children: reservation.children,
    guestPhone: reservation.guestPhone,
    guestEmail: reservation.guestEmail ?? '',
    seatType: reservation.seatType ?? '',
    purpose: reservation.purpose ?? '',
    allergyNote: reservation.allergyNote ?? '',
    requestNote: reservation.requestNote ?? '',
  });
  const [detailsPending, startDetailsTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('payment_intents')
        .select('amount')
        .eq('reservation_id', reservation.id)
        .in('purpose', ['booking_prepay', 'booking_deposit'])
        .eq('status', 'succeeded')
        .limit(1)
        .maybeSingle();
      if (!cancelled) setPrepay(data ? { amount: data.amount } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [reservation.id, supabase]);

  const saveMemo = () => {
    startMemoTransition(async () => {
      try {
        await updateReservationMemo(reservation.id, memo);
        toast('内部メモを更新しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  const changeStaff = (value: string) => {
    setStaffId(value);
    startStaffTransition(async () => {
      try {
        await updateReservationStaff(reservation.id, value || null);
        toast('担当者を更新しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  const togglePrivateHire = (value: boolean) => {
    setPrivateHire(value);
    startPrivateTransition(async () => {
      try {
        await updateReservationPrivateHire(reservation.id, value);
        toast(value ? '貸切に設定しました' : '貸切設定を解除しました');
      } catch (e) {
        setPrivateHire(!value);
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  const setDetail = <K extends keyof typeof details>(key: K, value: (typeof details)[K]) => setDetails((d) => ({ ...d, [key]: value }));

  const saveDetails = () => {
    startDetailsTransition(async () => {
      try {
        await updateReservationDetails(reservation.id, {
          adults: details.adults,
          children: details.children,
          guestPhone: details.guestPhone,
          guestEmail: details.guestEmail || null,
          seatType: details.seatType || null,
          purpose: details.purpose || null,
          allergyNote: details.allergyNote || null,
          requestNote: details.requestNote || null,
        });
        toast('予約内容を更新しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });
  };

  const stayMinutes = Math.max(
    0,
    Math.round((new Date(reservation.endAt).getTime() - new Date(reservation.startAt).getTime()) / 60000)
  );

  return (
    <Dialog open onClose={onClose} title="予約詳細" wide>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-bold tracking-wider text-primary-deep tabular-nums">{reservation.code}</span>
        <div className="flex items-center gap-2">
          {prepay && <Badge tone="success">事前決済済み {yen(prepay.amount)}</Badge>}
          {reservation.isPrivateHire && <Badge tone="primary">貸切</Badge>}
          <Badge tone={RESERVATION_STATUS[reservation.status].tone}>{RESERVATION_STATUS[reservation.status].label}</Badge>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3">
        <StatusActions reservationId={reservation.id} status={reservation.status} size="sm" />
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

      <dl>
        <Row
          label="日時"
          value={`${formatDate(reservation.reservedDate)} ${formatTime(reservation.startAt)}〜${formatTime(reservation.endAt)}`}
        />
        <Row label="滞在予定" value={`${formatMinutes(stayMinutes)}（${stayMinutes}分）`} />
        <Row label="お名前" value={`${reservation.guestName} 様`} />
        <Row label="フリガナ" value={reservation.guestNameKana} />
        <Row label="コース" value={reservation.courseName} />
        <Row label="割当テーブル" value={reservation.tableNames.length > 0 ? reservation.tableNames.join('、') : '未割当'} />
        <Row label="経路" value={reservation.sourceName} />
        <Row label="登録方法" value={CREATED_VIA_LABEL[reservation.createdVia] ?? reservation.createdVia} />
        {reservation.storeName && <Row label="店舗" value={reservation.storeName} />}
      </dl>

      <div className="mt-4 rounded-lg border border-gray-200 p-3">
        <p className="mb-3 text-sm font-semibold text-navy">予約内容</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="detail-adults">大人</Label>
            <Input
              id="detail-adults"
              type="number"
              min={0}
              value={details.adults}
              onChange={(e) => setDetail('adults', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="detail-children">子ども</Label>
            <Input
              id="detail-children"
              type="number"
              min={0}
              value={details.children}
              onChange={(e) => setDetail('children', Number(e.target.value))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="detail-phone">電話番号</Label>
            <Input id="detail-phone" type="tel" value={details.guestPhone} onChange={(e) => setDetail('guestPhone', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="detail-email">メール</Label>
            <Input id="detail-email" type="email" value={details.guestEmail} onChange={(e) => setDetail('guestEmail', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="detail-seat">席の希望</Label>
            <Input id="detail-seat" value={details.seatType} onChange={(e) => setDetail('seatType', e.target.value)} />
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="detail-purpose">利用目的</Label>
            <Input id="detail-purpose" value={details.purpose} onChange={(e) => setDetail('purpose', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="detail-allergy">アレルギー</Label>
            <Textarea id="detail-allergy" rows={2} value={details.allergyNote} onChange={(e) => setDetail('allergyNote', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="detail-request">お客様のご要望</Label>
            <Textarea id="detail-request" rows={2} value={details.requestNote} onChange={(e) => setDetail('requestNote', e.target.value)} />
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={saveDetails} disabled={detailsPending}>
            予約内容を保存
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="detail-staff">担当者</Label>
          <Select id="detail-staff" value={staffId} disabled={staffPending} onChange={(e) => changeStaff(e.target.value)}>
            <option value="">未設定</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="detail-private">貸切設定</Label>
          <label
            className={`flex h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm ${
              canManagePrivateHire ? 'cursor-pointer' : 'cursor-not-allowed bg-gray-100 text-gray-400'
            }`}
          >
            <input
              id="detail-private"
              type="checkbox"
              checked={privateHire}
              disabled={!canManagePrivateHire || privatePending}
              onChange={(e) => togglePrivateHire(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            この時間帯は他の予約を受け付けない
          </label>
        </div>
      </div>
      {!canManagePrivateHire && <p className="mt-1 text-xs text-gray-400">貸切設定の変更には店舗設定の権限が必要です。</p>}
      <p className="mt-1 text-xs text-gray-400">貸切に設定すると、この時間帯はオンライン予約でも満席として表示されます。</p>

      <div className="mt-4">
        <Label htmlFor="detail-memo">内部メモ（店舗スタッフのみ表示）</Label>
        <Textarea id="detail-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={saveMemo} disabled={memoPending}>
            メモを保存
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
