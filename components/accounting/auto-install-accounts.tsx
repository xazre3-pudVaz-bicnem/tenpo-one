'use client';

import { useTransition } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { installStandardAccounts } from '@/app/app/accounting/auto/actions';

/** 勘定科目が未導入の組織向けの案内バナー。標準テンプレートを1クリックで導入できる（冪等・何度でも安全）。 */
export function InstallAccountsBanner() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleInstall() {
    startTransition(async () => {
      try {
        await installStandardAccounts();
        toast('標準の勘定科目を導入しました');
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '導入に失敗しました', 'error');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-navy">
          この企業には勘定科目がまだ導入されていません。標準の勘定科目テンプレート（現金・売上高・仕入高・給与手当 等）を導入すると自動仕訳が利用できます。
        </p>
      </div>
      <Button type="button" size="sm" onClick={handleInstall} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        標準科目を導入する
      </Button>
    </div>
  );
}
