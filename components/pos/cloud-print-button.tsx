'use client';

import { useTransition } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { enqueueReceiptPrint } from '@/app/app/pos/print-actions';

/**
 * CloudPRNT対応プリンタへレシート印字ジョブを送るボタン。
 * プリンタが次回ポーリング時に取得して印字する（ブラウザ印刷の window.print とは別経路）。
 */
export function CloudPrintButton({
  orderId,
  jobType,
  reissue,
}: {
  orderId: string;
  jobType: 'receipt' | 'ryoshusho';
  reissue?: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const handleClick = () =>
    startTransition(async () => {
      const res = await enqueueReceiptPrint(orderId, { reissue, jobType });
      if (res.ok) toast('プリンタへ送信しました（数秒後に印字されます）');
      else toast(res.error ?? '送信に失敗しました', 'error');
    });

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex h-14 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-60 print:hidden"
    >
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
      プリンタで印刷
    </button>
  );
}
