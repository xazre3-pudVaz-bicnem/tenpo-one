'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { approveRequest, rejectRequest } from '@/app/app/attendance/actions';

/** 勤怠修正申請の承認・却下ボタン */
export function RequestReview({ requestId }: { requestId: string }) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const { toast } = useToast();

  const handle = async (reason: string) => {
    const result =
      mode === 'approve' ? await approveRequest(requestId) : await rejectRequest(requestId, reason);
    toast(result.message, result.ok ? 'success' : 'error');
  };

  return (
    <div className="flex justify-end gap-2">
      <Button variant="success" size="sm" onClick={() => setMode('approve')}>
        <Check className="h-3.5 w-3.5" />
        承認
      </Button>
      <Button variant="danger" size="sm" onClick={() => setMode('reject')}>
        <X className="h-3.5 w-3.5" />
        却下
      </Button>
      <ConfirmDialog
        open={mode === 'approve'}
        onClose={() => setMode(null)}
        title="修正申請を承認"
        message="この内容で勤怠記録を更新します。よろしいですか。"
        confirmLabel="承認する"
        destructive={false}
        onConfirm={handle}
      />
      <ConfirmDialog
        open={mode === 'reject'}
        onClose={() => setMode(null)}
        title="修正申請を却下"
        message="この申請を却下します。理由を入力してください。"
        confirmLabel="却下する"
        requireReason
        destructive
        onConfirm={handle}
      />
    </div>
  );
}
