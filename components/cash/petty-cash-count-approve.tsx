'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { approvePettyCashCount } from '@/app/app/cash/actions';

/** 実査結果の承認ボタン（cash.approve権限者のみ表示） */
export function PettyCashCountApprove({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleApprove = () => {
    startTransition(async () => {
      try {
        await approvePettyCashCount(id);
        toast('実査結果を承認しました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '承認に失敗しました', 'error');
      }
    });
  };

  return (
    <Button size="sm" variant="success" onClick={handleApprove} disabled={pending}>
      承認
    </Button>
  );
}
