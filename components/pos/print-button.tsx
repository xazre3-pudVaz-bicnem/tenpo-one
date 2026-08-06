'use client';

import { useTransition } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function PrintButton({
  orderId,
  jobType,
  logPrintJobAction,
}: {
  orderId: string;
  jobType: 'receipt' | 'ryoshusho';
  logPrintJobAction: (orderId: string, jobType: 'receipt' | 'ryoshusho') => Promise<void>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const handlePrint = () => {
    window.print();
    startTransition(async () => {
      try {
        await logPrintJobAction(orderId, jobType);
      } catch (e) {
        toast(e instanceof Error ? e.message : '印刷履歴の記録に失敗しました', 'error');
      }
    });
  };

  return (
    <Button size="pos" onClick={handlePrint} disabled={pending} className="print:hidden">
      <Printer className="h-5 w-5" />
      印刷
    </Button>
  );
}
