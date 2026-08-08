'use client';

import { useTransition } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { withdrawLeaveRequest } from '@/app/app/leave/actions';

/** 有給申請の取下げボタン（本人・pending中のみ表示） */
export function WithdrawLeaveRequestButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handle = () => {
    startTransition(async () => {
      const result = await withdrawLeaveRequest(requestId);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };

  return (
    <Button variant="secondary" size="sm" onClick={handle} disabled={pending}>
      <X className="h-3.5 w-3.5" />
      取下げ
    </Button>
  );
}
