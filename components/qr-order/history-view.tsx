'use client';

import { Loader2, Receipt } from 'lucide-react';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useQrStrings } from './strings-context';
import { openServiceCall } from './logic';
import { KITCHEN_STATUS_LABELS, type KitchenStatus, type QrOrderStatus, type QrServiceCall } from './types';
import { BillSummary, PageTitle, PrimaryButton, QrEmpty, QrError, QrNote } from './ui';

/**
 * 履歴・会計タブ。送信済みの注文だけを出し、未送信カートは合計に混ぜない。
 * 状況は get_qr_order_status の10秒ポーリング（匿名セッションのためRealtimeは使えない）。
 */

const STATUS_STYLES: Record<KitchenStatus, string> = {
  pending: 'bg-lilac text-ink-3',
  preparing: 'bg-saffron-soft text-saffron',
  ready: 'bg-success-soft text-success',
  served: 'bg-lilac text-[#5e4e5a]',
};

export function HistoryView({
  status,
  loading,
  fetchError,
  calls,
  calling,
  callError,
  onRequestCheckout,
}: {
  status: QrOrderStatus | null;
  loading: boolean;
  fetchError: string | null;
  calls: QrServiceCall[];
  calling: boolean;
  callError: string | null;
  onRequestCheckout: () => void;
}) {
  const qrStrings = useQrStrings();
  const checkoutCall = openServiceCall(calls, 'checkout');

  return (
    <div className="pb-6">
      <PageTitle
        eyebrow={qrStrings.history.eyebrow}
        title={qrStrings.history.title}
        description={qrStrings.history.description}
      />

      {fetchError && <QrError>{fetchError}</QrError>}

      {loading && !status ? (
        <div className="flex justify-center py-12 text-ink-3">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !status ? null : status.items.length === 0 ? (
        <QrEmpty>{qrStrings.history.empty}</QrEmpty>
      ) : (
        <ul className="mx-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {status.items.map((item, index) => (
            <li key={`${item.name}-${item.ordered_at}-${index}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">
                  {item.name} <span className="font-num">× {item.quantity}</span>
                </p>
                <p className="mt-0.5 font-num text-[10px] text-ink-3">
                  {item.ordered_at} {qrStrings.history.orderedAtSuffix}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold',
                  STATUS_STYLES[item.kitchen_status] ?? 'bg-lilac text-ink-3'
                )}
              >
                {KITCHEN_STATUS_LABELS[item.kitchen_status] ?? item.kitchen_status}
              </span>
            </li>
          ))}
        </ul>
      )}

      <BillSummary label={qrStrings.history.total} amount={yen(status?.total ?? 0)} />
      <QrNote>{qrStrings.history.note}</QrNote>

      {callError && <QrError>{callError}</QrError>}

      <div className="px-5">
        {checkoutCall ? (
          <div className="rounded-xl border border-iris/30 bg-lilac px-4 py-4 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-iris">
              <Receipt className="h-4 w-4" />
              {qrStrings.history.checkoutPending}
            </p>
            <p className="mt-1 font-num text-[11px] text-ink-3">
              {qrStrings.history.receivedAt(checkoutCall.created_at)}
            </p>
          </div>
        ) : (
          <PrimaryButton onClick={onRequestCheckout} disabled={calling}>
            {calling && <Loader2 className="h-4 w-4 animate-spin" />}
            {qrStrings.history.checkout}
          </PrimaryButton>
        )}
      </div>

      <QrNote className="pt-3 text-center">{qrStrings.history.payNotice}</QrNote>
    </div>
  );
}
