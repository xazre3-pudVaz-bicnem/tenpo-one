'use client';

import { Bell, Loader2 } from 'lucide-react';
import { useQrStrings } from './strings-context';
import { openServiceCall } from './logic';
import type { QrServiceCall } from './types';
import { PageTitle, PrimaryButton, QrError, QrNote } from './ui';
import { ServicePanel } from './service-panel';
import type { QrServiceItem, QrServiceRequestLine } from '@/lib/qr-service';

/**
 * 呼び出しタブ。スタッフ呼び出し（kind='staff'）を登録する。
 * 会計希望（kind='checkout'）は履歴・会計タブの別種類として扱い、ここでは状況のみ知らせる。
 * 下に「サービス」（お水・お箸など。メニューの最後のタブと同じ）も出す（2026-10-18 Ronnie）。
 */
export function CallView({
  tableName,
  calls,
  calling,
  error,
  onCallStaff,
  onBackToMenu,
  serviceItems = [],
  serviceSending = false,
  serviceError = null,
  onSendService,
}: {
  tableName: string;
  calls: QrServiceCall[];
  calling: boolean;
  error: string | null;
  onCallStaff: () => void;
  onBackToMenu: () => void;
  serviceItems?: QrServiceItem[];
  serviceSending?: boolean;
  serviceError?: string | null;
  onSendService?: (lines: QrServiceRequestLine[]) => Promise<boolean>;
}) {
  const qrStrings = useQrStrings();
  const staffCall = openServiceCall(calls, 'staff');
  const checkoutCall = openServiceCall(calls, 'checkout');

  return (
    <div className="pb-6">
      <PageTitle
        eyebrow={qrStrings.call.eyebrow}
        title={qrStrings.call.title}
        description={qrStrings.call.description(tableName)}
      />

      <div className="px-5">
        <p className="mb-5 text-xs text-ink-3">{qrStrings.call.lead}</p>

        {error && <QrError>{error}</QrError>}

        {staffCall ? (
          <div className="rounded-xl border border-iris/30 bg-lilac px-4 py-5 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-iris">
              <Bell className="h-4 w-4" />
              {qrStrings.call.pending}
            </p>
            <p className="mt-1.5 font-num text-[11px] leading-relaxed text-ink-3">
              {qrStrings.call.receivedAt(staffCall.created_at)}
            </p>
          </div>
        ) : (
          <PrimaryButton onClick={onCallStaff} disabled={calling}>
            {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            {calling ? qrStrings.call.sending : qrStrings.call.button}
          </PrimaryButton>
        )}

        {checkoutCall && (
          <p className="mt-3 text-center font-num text-[11px] text-ink-3">
            {qrStrings.call.checkoutPending}（{checkoutCall.created_at}）
          </p>
        )}

        {serviceItems.length > 0 && onSendService && (
          <div className="-mx-5 mt-4 border-t border-line">
            <ServicePanel items={serviceItems} sending={serviceSending} error={serviceError} onSend={onSendService} />
          </div>
        )}

        <button
          type="button"
          onClick={onBackToMenu}
          className="mt-2.5 min-h-11 w-full text-sm font-bold text-iris"
        >
          {qrStrings.call.backToMenu}
        </button>
      </div>

      <QrNote className="pt-4">{qrStrings.call.note}</QrNote>
    </div>
  );
}
