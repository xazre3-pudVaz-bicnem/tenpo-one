'use client';

import { useTransition } from 'react';
import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { markAllRead } from './actions';

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        await markAllRead();
        toast('すべて既読にしました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '処理に失敗しました', 'error');
      }
    });
  };

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
      <CheckCheck className="h-3.5 w-3.5" />
      すべて既読にする
    </Button>
  );
}
