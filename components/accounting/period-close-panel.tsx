'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Unlock, History, ArrowRight, Info, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { Table, TableWrap, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { PERIOD_STATUS_LABELS, PERIOD_STATUS_TONES } from '@/components/accounting/labels';
import { canWriteAccounting, canReopenPeriod } from '@/components/accounting/roles';
import type { Role } from '@/lib/permissions';
import { getPeriodStatus, closeMonth, reopenMonth } from '@/app/app/accounting/actions';
import { listPeriodOverview, getPeriodAuditHistory, type PeriodOverviewRow, type PeriodAuditEntry } from '@/app/app/accounting/auto/period-actions';

const HISTORY_ACTION_LABELS: Record<PeriodAuditEntry['action'], string> = {
  'accounting.period_close': '締め',
  'accounting.period_reopen': '締め解除',
};

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

/** 月末日('YYYY-MM-DD')。絞り込みリンクのto指定に使う */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function draftFilterHref(month: string): string {
  const params = new URLSearchParams({ from: `${month}-01`, to: monthEnd(month), status: 'draft' });
  return `/app/accounting?${params.toString()}`;
}

/** 月次締めパネル: 直近12ヶ月の締め状況一覧・締め処理・締め解除（理由必須・履歴表示）を行う */
export function PeriodClosePanel({ initialMonth, role }: { initialMonth: string; role: Role | null }) {
  const [month, setMonth] = useState(initialMonth);
  const [status, setStatus] = useState<'open' | 'closed' | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PeriodOverviewRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [history, setHistory] = useState<PeriodAuditEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const result = await getPeriodAuditHistory(month);
        if (!cancelled) setHistory(result);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const result = await listPeriodOverview(initialMonth, 12);
      setOverview(result);
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOverview(true);
      try {
        const result = await listPeriodOverview(initialMonth, 12);
        if (!cancelled) setOverview(result);
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialMonth]);

  const refresh = async () => {
    const [result, historyResult] = await Promise.all([getPeriodStatus(month), getPeriodAuditHistory(month)]);
    setStatus(result.status);
    setDraftCount(result.draftCount);
    setHistory(historyResult);
    await loadOverview();
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

  const selectedRow = overview.find((r) => r.month === month) ?? null;
  // 直近の締め解除がその後の締めより新しい＝解除されたまま未再締めの状態
  const justReopened =
    status === 'open' &&
    !!selectedRow?.reopenedAt &&
    (!selectedRow.closedAt || new Date(selectedRow.reopenedAt) > new Date(selectedRow.closedAt));

  return (
    <Card>
      <CardHeader>
        <CardTitle>月次締め</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>
            締め前の月は仕訳の作成・修正・確定ができます。締め後は通常ユーザーによる計上・修正ができなくなり、修正するには
            org_owner / hq_admin による締め解除（理由必須・操作履歴に記録）が必要です。
          </span>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-navy">直近12ヶ月の状況</p>
          {loadingOverview ? (
            <p className="text-sm text-gray-400">読み込み中…</p>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>月</Th>
                    <Th>状態</Th>
                    <Th>締め日時 / 実行者</Th>
                    <Th>解除日時 / 実行者</Th>
                    <Th className="text-right">下書き</Th>
                    <Th></Th>
                  </Tr>
                </THead>
                <TBody>
                  {overview.map((row) => (
                    <Tr key={row.month} className={row.month === month ? 'bg-primary-soft/40' : undefined}>
                      <Td className="whitespace-nowrap font-medium text-navy">{monthLabel(row.month)}</Td>
                      <Td>
                        <Badge tone={PERIOD_STATUS_TONES[row.status]}>{PERIOD_STATUS_LABELS[row.status]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-gray-600">
                        {row.closedAt ? (
                          <>
                            {formatDateTime(row.closedAt)}
                            {row.closedByName && <span className="text-gray-400">（{row.closedByName}）</span>}
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-gray-600">
                        {row.reopenedAt ? (
                          <>
                            {formatDateTime(row.reopenedAt)}
                            {row.reopenedByName && <span className="text-gray-400">（{row.reopenedByName}）</span>}
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{row.draftCount > 0 ? row.draftCount : '—'}</Td>
                      <Td>
                        <Button
                          type="button"
                          size="sm"
                          variant={row.month === month ? 'primary' : 'secondary'}
                          onClick={() => setMonth(row.month)}
                        >
                          選択
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 p-4">
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
            <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={busy}>
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {!loading && justReopened && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              <span>この月は締め解除されています。仕訳を修正したうえで、再度この月を締めてください。</span>
              <Link href={draftFilterHref(month)} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                下書き仕訳を確認する <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {!loading && status !== 'closed' && (
            <div className="mt-3">
              {draftCount > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-warning">
                  <span>下書き仕訳が{draftCount}件残っています（締めるには確定が必要です）</span>
                  <Link href={draftFilterHref(month)} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                    下書き一覧を絞り込んで見る <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
              <Button size="sm" onClick={() => void handleClose()} disabled={busy || draftCount > 0}>
                <Lock className="h-4 w-4" />
                {busy ? '処理中…' : 'この月を締める'}
              </Button>
            </div>
          )}

          {!loading && status === 'closed' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-500">締め済みの月です。修正には締め解除が必要です。</p>
              {canReopenPeriod(role) ? (
                <Button size="sm" variant="secondary" onClick={() => setReopenOpen(true)}>
                  <Unlock className="h-4 w-4" />
                  締め解除
                </Button>
              ) : (
                <p className="text-xs text-gray-400">締め解除は org_owner / hq_admin のみ実行できます。</p>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-navy">
            <History className="h-4 w-4 text-gray-400" />
            {monthLabel(month)}の締め・解除履歴
          </p>
          {loadingHistory ? (
            <p className="text-sm text-gray-400">読み込み中…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400">履歴はありません</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.action === 'accounting.period_close' ? 'success' : 'warning'}>
                      {HISTORY_ACTION_LABELS[h.action]}
                    </Badge>
                    <span className="text-gray-500">{formatDateTime(h.createdAt)}</span>
                    {h.actorName && <span className="text-gray-500">{h.actorName}</span>}
                  </div>
                  {h.reason && <p className="mt-1 text-gray-600">理由: {h.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {reopenOpen && (
        <ConfirmDialog
          open
          onClose={() => setReopenOpen(false)}
          title="締め解除"
          message={`${monthLabel(month)}の締めを解除します。解除の理由は操作履歴に記録されます。解除後は仕訳を修正したうえで、再度締め処理を行ってください。`}
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
