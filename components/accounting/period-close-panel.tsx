'use client';

import { useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { PERIOD_STATUS_LABELS, PERIOD_STATUS_TONES } from '@/components/accounting/labels';
import { canWriteAccounting, canReopenPeriod } from '@/components/accounting/roles';
import type { Role } from '@/lib/permissions';
import { getPeriodStatus, closeMonth, reopenMonth } from '@/app/app/accounting/actions';

/** 月次締めパネル: 月を選び、締め状態を確認・締め処理・締め解除を行う */
export function PeriodClosePanel({ initialMonth, role }: { initialMonth: string; role: Role | null }) {
  const [month, setMonth] = useState(initialMonth);
  const [status, setStatus] = useState<'open' | 'closed' | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await getPeriodStatus(month);
        if (cancelled) return;
        setStatus(result.status);
        setDraftCount(result.draftCount);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const refresh = async () => {
    const result = await getPeriodStatus(month);
    setStatus(result.status);
    setDraftCount(result.draftCount);
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      const result = await closeMonth(month);
      if (result.error) {
        toast(result.error, 'error');
        await refresh();
        return;
      }
      toast(`${month}を締めました`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!canWriteAccounting(role)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>月次締め</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="close-month">対象月</Label>
            <Input id="close-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          </div>
          <div className="pb-2">
            {loading ? (
              <span className="text-sm text-gray-400">読み込み中…</span>
            ) : (
              <Badge tone={PERIOD_STATUS_TONES[status ?? 'open']}>{PERIOD_STATUS_LABELS[status ?? 'open']}</Badge>
            )}
          </div>
        </div>

        {!loading && status !== 'closed' && (
          <div>
            {draftCount > 0 && <p className="mb-2 text-xs text-warning">下書き仕訳が{draftCount}件残っています（締めるには確定が必要です）</p>}
            <Button size="sm" onClick={() => void handleClose()} disabled={busy || draftCount > 0}>
              <Lock className="h-4 w-4" />
              {busy ? '処理中…' : 'この月を締める'}
            </Button>
          </div>
        )}

        {!loading && status === 'closed' && canReopenPeriod(role) && (
          <Button size="sm" variant="secondary" onClick={() => setReopenOpen(true)}>
            <Unlock className="h-4 w-4" />
            締め解除
          </Button>
        )}
      </CardContent>

      {reopenOpen && (
        <ConfirmDialog
          open
          onClose={() => setReopenOpen(false)}
          title="締め解除"
          message={`${month}の締めを解除します。解除の理由は操作履歴に記録されます。`}
          confirmLabel="締め解除する"
          requireReason
          destructive={false}
          onConfirm={async (reason) => {
            const result = await reopenMonth(month, reason);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast(`${month}の締めを解除しました`);
            await refresh();
          }}
        />
      )}
    </Card>
  );
}
