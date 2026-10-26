'use client';

import { useTransition } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useClerkGate } from '@/components/pos/clerk-gate';
import { printPeriodReport } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';

/**
 * 伝票明細の期間（昨日・一昨日・今週・今月・日付）の決算レポートをレシートプリンターへ出すボタン。
 * 押したときの 開始日・終了日 の欄（#from・#to）の日付で出す（「この条件で表示」を押す前に日付を変えていてもその日付）。
 * 2026-10-26 Ronnie「Yo thau bata native ra web bata 決算レポート nikalna milne banau … rezi printer bata print」
 */
export function PeriodReportPrintButton({ from, to, canPrint }: { from: string; to: string; canPrint: boolean }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const clerkGate = useClerkGate();
  if (!canPrint) return null;

  const print = () => {
    const f = (document.getElementById('from') as HTMLInputElement | null)?.value || from;
    const t = (document.getElementById('to') as HTMLInputElement | null)?.value || to;
    startTransition(async () => {
      try {
        const r = await printPeriodReport(f, t, clerkGate?.clerk?.name ?? null);
        if (!r.ok) {
          toast(r.error, 'error');
          return;
        }
        toast(f === t ? `${f.replaceAll('-', '/')} の決算レポートを印刷しています` : `${f.replaceAll('-', '/')}〜${t.slice(5).replaceAll('-', '/')} の決算レポートを印刷しています`);
      } catch (err) {
        toast(toUserMessage(err, '決算レポートを印刷できませんでした'), 'error');
      }
    });
  };

  return (
    <Button type="button" variant="secondary" onClick={print} disabled={pending} className="mr-auto">
      <Printer className="h-4 w-4" />
      {pending ? '印刷中…' : '決算レポートを印刷'}
    </Button>
  );
}
