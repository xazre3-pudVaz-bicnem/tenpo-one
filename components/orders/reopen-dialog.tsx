'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

export function ReopenDialog({
  orderId,
  reopenOrderAction,
}: {
  orderId: string;
  reopenOrderAction: (orderId: string, reason: string) => Promise<{ orderId: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const handleConfirm = async (reason: string) => {
    try {
      const { orderId: newOrderId } = await reopenOrderAction(orderId, reason);
      toast('再会計用の新しい伝票を作成しました', 'success');
      router.push(`/app/pos?order=${newOrderId}`);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : '処理に失敗しました。通信状態を確認して再度お試しください',
        'error'
      );
    }
  };

  return (
    <>
      <Button variant="navy" className="w-full" onClick={() => setOpen(true)}>
        再会計する
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="再会計しますか"
        message="この取引は返金済みのまま残ります。品目を複製した新しい会計前の伝票を作成し、POSで開けるようにします。理由を記録してください。"
        confirmLabel="再会計する"
        requireReason
        destructive={false}
        onConfirm={handleConfirm}
      />
    </>
  );
}
