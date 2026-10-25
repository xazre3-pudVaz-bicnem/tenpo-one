'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { DEVICE_TYPE_LABELS, type ApprovalStatus, type DeviceType } from '@/lib/device-control';
import { approveStoreDevice, rejectStoreDevice, revokeStoreDevice } from '@/app/admin/tenants/device-actions';

/**
 * コントロールセンター：端末1台の「承認」「却下」「解除」「承認し直す」ボタン（店舗の詳細・全店舗の承認待ちで同じ）。
 *   承認待ち → 承認 / 却下
 *   承認済みで使用中 → 解除
 *   解除済み・却下（レジ・ハンディ）→ 承認し直す（ディスプレイはつなぎ直しが要るので出さない）
 */
export function DeviceApprovalActions({
  storeId,
  type,
  deviceId,
  deviceName,
  approval,
  active,
  ready,
}: {
  storeId: string;
  type: DeviceType;
  deviceId: string;
  deviceName: string;
  approval: ApprovalStatus;
  active: boolean;
  /** migration 00104 が適用済み（承認・却下・承認し直しは適用後だけ） */
  ready: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<'reject' | 'revoke' | null>(null);

  const run = (fn: () => Promise<{ error?: string; warning?: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.error) toast(r.error, 'error');
      else {
        toast(r.warning ?? done, r.warning ? 'warning' : 'success');
        router.refresh();
      }
    });

  const target = { storeId, type, deviceId };
  const label = DEVICE_TYPE_LABELS[type];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {ready && approval === 'pending' && active && (
        <>
          <Button size="sm" onClick={() => run(() => approveStoreDevice(target), `「${deviceName}」を承認しました`)} disabled={pending}>
            承認
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm('reject')} disabled={pending}>
            却下
          </Button>
        </>
      )}
      {approval === 'approved' && active && (
        <Button size="sm" variant="ghost" onClick={() => setConfirm('revoke')} disabled={pending}>
          解除
        </Button>
      )}
      {ready && type !== 'display' && !(approval === 'pending' && active) && !(approval === 'approved' && active) && (
        <Button size="sm" variant="outline" onClick={() => run(() => approveStoreDevice(target), `「${deviceName}」を承認し直しました`)} disabled={pending}>
          承認し直す
        </Button>
      )}

      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title={confirm === 'reject' ? `「${deviceName}」を却下しますか？` : `「${deviceName}」を解除しますか？`}
          message={
            confirm === 'reject'
              ? `この${label}は使えないままになります（端末には「承認されませんでした」と出ます）。`
              : `この${label}はすぐに使えなくなります。${type === 'display' ? 'もう一度使うにはQRコードでつなぎ直し、承認が必要です。' : 'もう一度使うには「承認し直す」を押してください。'}`
          }
          confirmLabel={confirm === 'reject' ? '却下する' : '解除する'}
          onConfirm={() => {
            const which = confirm;
            setConfirm(null);
            if (which === 'reject') run(() => rejectStoreDevice(target), `「${deviceName}」を却下しました`);
            else run(() => revokeStoreDevice(target), `「${deviceName}」を解除しました`);
          }}
        />
      )}
    </div>
  );
}
