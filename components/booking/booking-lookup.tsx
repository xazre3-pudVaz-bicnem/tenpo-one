'use client';

import { useMemo, useState } from 'react';
import { Loader2, Phone, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { bookingErrorMessage, type PublicReservation } from './types';

const STATUS_LABEL: Record<string, string> = {
  pending: '確認中',
  confirmed: 'ご予約確定',
  seated: 'ご来店済み',
  completed: 'ご利用済み',
  cancelled: 'キャンセル済み',
  no_show: '不成立',
  waitlisted: 'キャンセル待ち',
};

function jstDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+09:00`);
}

function isPastDeadline(deadline: Date): boolean {
  return Date.now() >= deadline.getTime();
}

export function BookingLookup({ code: initialCode }: { code?: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [code, setCode] = useState(initialCode ?? '');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<PublicReservation | null>(null);

  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);

  const handleLookup = async () => {
    if (!code.trim() || phone.trim().length < 10) {
      setError('予約コードと電話番号をご確認ください。');
      return;
    }
    setLoading(true);
    setError(null);
    setReservation(null);
    const { data, error: rpcError } = await supabase.rpc('get_public_reservation', {
      p_code: code.trim(),
      p_phone: phone.trim(),
    });
    setLoading(false);
    if (rpcError || !data) {
      setError(bookingErrorMessage(rpcError?.message ?? 'NOT_FOUND'));
      return;
    }
    setReservation(data as PublicReservation);
  };

  const handleCancel = async () => {
    if (!reservation) return;
    setCancelling(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('cancel_public_reservation', {
      p_code: reservation.code,
      p_phone: phone.trim(),
      p_reason: cancelReason.trim() || null,
    });
    setCancelling(false);
    if (rpcError) {
      setError(bookingErrorMessage(rpcError.message));
      return;
    }
    setCancelled(true);
    setShowCancelForm(false);
  };

  if (reservation) {
    const start = jstDate(reservation.reserved_date, reservation.time);
    const deadline = new Date(start.getTime() - reservation.cancel_deadline_hours * 3600000);
    const pastDeadline = isPastDeadline(deadline);
    const status = cancelled ? 'cancelled' : reservation.status;
    const cancellable = !cancelled && ['pending', 'confirmed'].includes(reservation.status) && !pastDeadline;

    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-xs font-medium text-gray-500">予約コード</p>
          <p className="mt-1 text-xl font-bold tracking-wider text-primary-deep tabular-nums">{reservation.code}</p>

          <dl className="mt-5 space-y-3 border-t border-gray-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">店舗</dt>
              <dd className="font-medium text-navy">{reservation.store_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">日時</dt>
              <dd className="font-medium text-navy">
                {reservation.reserved_date.replaceAll('-', '/')} {reservation.time}〜
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">人数</dt>
              <dd className="font-medium text-navy">{reservation.party_size}名</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">お名前</dt>
              <dd className="font-medium text-navy">{reservation.guest_name} 様</dd>
            </div>
            {reservation.course_name && (
              <div className="flex justify-between">
                <dt className="text-gray-500">コース</dt>
                <dd className="font-medium text-navy">{reservation.course_name}</dd>
              </div>
            )}
            {reservation.request_note && (
              <div>
                <dt className="text-gray-500">ご要望</dt>
                <dd className="mt-1 text-navy">{reservation.request_note}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">状態</dt>
              <dd className="font-semibold text-navy">{STATUS_LABEL[status] ?? status}</dd>
            </div>
          </dl>

          {cancelled && (
            <div className="mt-5 rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
              ご予約をキャンセルしました。
            </div>
          )}

          {!cancelled && !['pending', 'confirmed'].includes(reservation.status) && (
            <p className="mt-5 text-xs text-gray-500">この予約は変更・キャンセルできません。</p>
          )}

          {!cancelled && ['pending', 'confirmed'].includes(reservation.status) && pastDeadline && (
            <div className="mt-5 rounded-lg bg-warning-soft px-4 py-3 text-xs text-warning">
              キャンセル受付期限（来店{reservation.cancel_deadline_hours}時間前）を過ぎたため、Web上での変更・キャンセルはできません。お手数ですがお電話にてご連絡ください。
              {reservation.store_phone && (
                <a href={`tel:${reservation.store_phone}`} className="mt-2 flex items-center gap-1 font-semibold text-navy">
                  <Phone className="h-3.5 w-3.5" />
                  {reservation.store_phone}
                </a>
              )}
            </div>
          )}

          {cancellable && !showCancelForm && (
            <button
              type="button"
              onClick={() => setShowCancelForm(true)}
              className="mt-5 h-11 w-full rounded-lg border border-danger text-sm font-semibold text-danger"
            >
              この予約をキャンセルする
            </button>
          )}

          {cancellable && showCancelForm && (
            <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
              <label htmlFor="cancel-reason" className="block text-sm font-medium text-gray-700">
                キャンセル理由（任意）
              </label>
              <textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancelForm(false)}
                  disabled={cancelling}
                  className="h-11 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-navy"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-danger text-sm font-semibold text-white disabled:opacity-50"
                >
                  {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
                  <XCircle className="h-4 w-4" />
                  キャンセルを確定
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-center text-lg font-bold text-navy">ご予約の確認・キャンセル</h1>
      <p className="mt-2 text-center text-sm text-gray-500">予約コードとお電話番号を入力してください。</p>

      <div className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
        <div>
          <label htmlFor="lookup-code" className="mb-1 block text-sm font-medium text-gray-700">
            予約コード
          </label>
          <input
            id="lookup-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm tracking-wider uppercase"
          />
        </div>
        <div>
          <label htmlFor="lookup-phone" className="mb-1 block text-sm font-medium text-gray-700">
            ご予約時のお電話番号
          </label>
          <input
            id="lookup-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09012345678"
            className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="button"
          onClick={handleLookup}
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          予約を確認する
        </button>
      </div>
    </div>
  );
}
