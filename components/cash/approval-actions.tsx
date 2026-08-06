'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

/** 承認待ち行に添える承認／差戻しボタン（両方サーバーアクションを呼び監査ログを記録する） */
export function ApprovalActions({
  onApprove,
  onReject,
  approveLabel = '承認',
  rejectLabel = '差戻し',
  rejectTitle = '差戻し',
  rejectMessage = '差戻しの理由を入力してください。申請者に理由が伝わります。',
}: {
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  approveLabel?: string;
  rejectLabel?: string;
  rejectTitle?: string;
  rejectMessage?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const { toast } = useToast();

  const handleApprove = () => {
    startTransition(async () => {
      try {
        await onApprove();
        toast('承認しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '承認に失敗しました', 'error');
      }
    });
  };

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="success" onClick={handleApprove} disabled={pending}>
        {approveLabel}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setRejectOpen(true)} disabled={pending}>
        {rejectLabel}
      </Button>
      <ConfirmDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={rejectTitle}
        message={rejectMessage}
        confirmLabel="差戻す"
        requireReason
        onConfirm={async (reason) => {
          try {
            await onReject(reason);
            toast('差戻しました');
          } catch (e) {
            toast(e instanceof Error ? e.message : '差戻しに失敗しました', 'error');
            throw e;
          }
        }}
      />
    </div>
  );
}
