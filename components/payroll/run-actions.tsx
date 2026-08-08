'use client';

import { useState, useTransition } from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { recalcPayrollRun, confirmPayrollRun, approvePayrollRun, revertPayrollRunToDraft } from '@/app/app/payroll/actions';

export function RunActions({
  runId,
  status,
  runType = 'salary',
}: {
  runId: string;
  status: 'draft' | 'confirmed' | 'approved';
  runType?: 'salary' | 'bonus';
}) {
  const [dialog, setDialog] = useState<'confirm' | 'approve' | 'revert' | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const recalc = () => {
    startTransition(async () => {
      const result = await recalcPayrollRun(runId);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };

  const runConfirm = async () => {
    const result = await confirmPayrollRun(runId);
    toast(result.message, result.ok ? 'success' : 'error');
  };

  const runApprove = async () => {
    const result = await approvePayrollRun(runId);
    toast(result.message, result.ok ? 'success' : 'error');
  };

  const runRevert = async () => {
    const result = await revertPayrollRunToDraft(runId);
    toast(result.message, result.ok ? 'success' : 'error');
  };

  // 承認済み(approved)runはDBトリガーでも変更を拒否される不変の状態のため操作を一切表示しない
  if (status === 'approved') return null;

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'draft' && (
        <>
          {runType === 'salary' && (
            <Button variant="secondary" onClick={recalc} disabled={pending}>
              <RefreshCw className="h-4 w-4" />
              再計算
            </Button>
          )}
          <Button onClick={() => setDialog('confirm')} disabled={pending}>
            <CheckCircle2 className="h-4 w-4" />
            確定
          </Button>
        </>
      )}
      {status === 'confirmed' && (
        <>
          <Button variant="secondary" onClick={() => setDialog('revert')} disabled={pending}>
            <Undo2 className="h-4 w-4" />
            下書きに戻す
          </Button>
          <Button onClick={() => setDialog('approve')} disabled={pending}>
            <ShieldCheck className="h-4 w-4" />
            承認
          </Button>
        </>
      )}

      <ConfirmDialog
        open={dialog === 'confirm'}
        onClose={() => setDialog(null)}
        title="給与計算を確定"
        message="この内容で確定します。確定後は再計算できません（再計算するには一旦下書きに戻す必要があります）。"
        confirmLabel="確定する"
        destructive={false}
        onConfirm={runConfirm}
      />
      <ConfirmDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title="給与計算を承認"
        message="承認すると内容を変更できなくなります（金額・計算根拠は以後不変になります）。よろしいですか。"
        confirmLabel="承認する"
        destructive={false}
        onConfirm={runApprove}
      />
      <ConfirmDialog
        open={dialog === 'revert'}
        onClose={() => setDialog(null)}
        title="給与計算を下書きに戻す"
        message="下書きに戻すと再計算が可能になります。勤怠修正申請の承認などで内容が変わった場合はこちらから再計算してください。"
        confirmLabel="下書きに戻す"
        destructive={false}
        onConfirm={runRevert}
      />
    </div>
  );
}
