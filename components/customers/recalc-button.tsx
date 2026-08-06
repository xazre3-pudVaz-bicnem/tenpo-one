'use client';

import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { recalcCustomerStats } from '@/app/app/customers/actions';

export function RecalcButton({ customerId }: { customerId: string }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleClick = () => {
    startTransition(async () => {
      try {
        await recalcCustomerStats(customerId);
        toast('集計を再計算しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '再計算に失敗しました', 'error');
      }
    });
  };

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
      集計を再計算
    </Button>
  );
}
