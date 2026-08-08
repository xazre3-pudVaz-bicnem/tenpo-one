'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { approveLeaveRequest, rejectLeaveRequest } from '@/app/app/leave/actions';

/** 有給申請の承認・却下ボタン（店長以上のロール用） */
export function LeaveRequestReview({ requestId }: { requestId: string }) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const { toast } = useToast();

  const handle = async (reason: string) => {
    const result = mode === 'approve' ? await approveLeaveRequest(requestId) : await rejectLeaveRequest(requestId, reason);
    toast(result.message, 'warning' in result && result.warning ? 'warning' : result.ok ? 'success' : 'error');
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
        title="有給申請を承認"
        message="承認すると勤怠記録に有給取得として反映されます。よろしいですか。"
        confirmLabel="承認する"
        destructive={false}
        onConfirm={handle}
      />
      <ConfirmDialog
        open={mode === 'reject'}
        onClose={() => setMode(null)}
        title="有給申請を却下"
        message="この申請を却下します。理由を入力してください。"
        confirmLabel="却下する"
        requireReason
        destructive
        onConfirm={handle}
      />
    </div>
  );
}
