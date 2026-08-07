'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { createMockPrintProvider } from '@/lib/printing/providers';
import { PRINT_STATUS_LABELS, type PrintResultStatus } from '@/lib/printing/types';
import { createTestPrint, finalizeTestPrintJob } from '@/app/app/settings/printers/actions';

/** テストダイアログで選択できる障害モード（実機未接続のためシミュレーションのみ） */
const MODES: PrintResultStatus[] = ['success', 'paper_out', 'offline', 'timeout'];

export function TestPrintDialog({
  open,
  onClose,
  printerId,
  printerName,
  connectionType,
  storeId,
}: {
  open: boolean;
  onClose: () => void;
  printerId: string;
  printerName: string;
  connectionType: string;
  storeId: string;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<PrintResultStatus>('success');
  const [result, setResult] = useState<{ status: PrintResultStatus; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClose = () => {
    setResult(null);
    setMode('success');
    onClose();
  };

  const handleRun = () => {
    startTransition(async () => {
      const created = await createTestPrint(printerId, storeId);
      if (created.error || !created.jobId) {
        toast(created.error ?? 'テスト印刷の作成に失敗しました', 'error');
        return;
      }

      // browser接続かつ成功モードのみ、実際の印刷ダイアログを開いて実機同等の検証を行う。
      // それ以外（実機未接続の接続方式・障害モード）はMock Providerでシミュレーションする。
      if (connectionType === 'browser' && mode === 'success') {
        window.open(`/app/settings/printers/test-print?job=${created.jobId}`, '_blank', 'noopener,noreferrer');
        toast('印刷ダイアログを別タブで開きました', 'success');
        handleClose();
        return;
      }

      const provider = createMockPrintProvider(mode);
      const printResult = await provider.print({ kind: 'test', data: {}, paperWidth: 80 });
      await finalizeTestPrintJob(created.jobId, printResult.status, printResult.message ?? PRINT_STATUS_LABELS[printResult.status]);
      setResult(printResult);
    });
  };

  return (
    <Dialog open={open} onClose={handleClose} title={`テスト印刷: ${printerName}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          実機・SDKは未接続のため、結果をシミュレーションで確認します。モードを選んで実行してください。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setResult(null);
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors',
                mode === m ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {PRINT_STATUS_LABELS[m]}
            </button>
          ))}
        </div>

        {result && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
            <Badge tone={result.status === 'success' ? 'success' : 'danger'}>{PRINT_STATUS_LABELS[result.status]}</Badge>
            {result.message && <span className="text-xs text-gray-500">{result.message}</span>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={pending}>
            閉じる
          </Button>
          <Button onClick={handleRun} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                実行中…
              </>
            ) : (
              'テスト印刷を実行'
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
