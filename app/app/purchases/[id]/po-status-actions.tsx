'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { changePurchaseOrderStatus, cancelPurchaseOrder } from '../actions';

/** 発注書の状態遷移ボタン群（申請・承認・発注確定・取消） */
export function PoStatusActions({ poId, status }: { poId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const run = async (action: 'request' | 'approve' | 'order', label: string) => {
    setBusy(true);
    try {
      await changePurchaseOrderStatus(poId, action);
      toast(label);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancellable = ['draft', 'requested', 'approved', 'ordered'].includes(status);

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'draft' && (
        <Button size="sm" onClick={() => run('request', '申請しました')} disabled={busy}>
          申請する
        </Button>
      )}
      {status === 'requested' && (
        <Button size="sm" variant="success" onClick={() => run('approve', '承認しました')} disabled={busy}>
          承認する
        </Button>
      )}
      {status === 'approved' && (
        <Button size="sm" onClick={() => run('order', '発注確定しました')} disabled={busy}>
          発注確定する
        </Button>
      )}
      {cancellable && (
        <Button size="sm" variant="danger" onClick={() => setShowCancel(true)} disabled={busy}>
          取消
        </Button>
      )}
      <ConfirmDialog
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title="発注を取消"
        message="この発注書を取消します。入荷済みの明細がある場合は取消できません。"
        requireReason
        confirmLabel="取消する"
        onConfirm={async (reason) => {
          await cancelPurchaseOrder(poId, reason);
          toast('発注を取消しました');
          router.refresh();
        }}
      />
    </div>
  );
}
