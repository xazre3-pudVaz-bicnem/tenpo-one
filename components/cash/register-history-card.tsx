'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { AlertTriangle, Lock, Printer } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen, formatDateTime } from '@/lib/format';
import { mdWeekdayLabel } from '@/lib/register-day';
import { historyStatusLabel, isOpenSession, unclosedPastSessions, type RegisterHistoryRow } from '@/lib/register-history';
import { printSettlementReport, reprintRegisterReport } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';

/**
 * 入出金 › 締め履歴 の「レジごとの履歴」（lib/register-history.ts）。
 * 前の営業日に締められなかったレジ（開いたまま）→ そのままレジ精算へ・途中集計を印刷。
 * 締めたレジ → 精算レシート・精算情報を日を選んで出し直す。
 * 2026-10-26 Ronnie「Web ipad ko 履歴 ma gayera hijo ko レジ決算 garna milne ra 決算レポート nikalna milne banau」
 */
export function RegisterHistoryCard({
  rows,
  clock,
  canOperate,
  showStore,
}: {
  rows: RegisterHistoryRow[];
  /** 時計の営業日（YYYY-MM-DD） */
  clock: string;
  canOperate: boolean;
  /** 全店舗を見ているとき（店舗名を出す・レジ精算への道は出さない） */
  showStore: boolean;
}) {
  const late = unclosedPastSessions(rows, clock);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle en="Register history">レジごとの履歴（レジ精算・精算レシート）</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            開いたままのレジは、ここからレジ精算へ進めます。締めたレジは精算レシートを出し直せます。
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {late.length > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {late.map((r) => `${mdWeekdayLabel(r.businessDate)} ${r.registerName}`).join('・')} がまだレジ精算されていません
              </p>
              <p className="mt-0.5 text-xs">
                このレジを締めるまで、同じレジは新しく開局できません。下の「レジ精算をする」から締めてください（締めると精算レシートが出ます）。
              </p>
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">この期間のレジの記録はありません</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <HistoryRow key={r.id} row={r} clock={clock} canOperate={canOperate} showStore={showStore} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ row, clock, canOperate, showStore }: { row: RegisterHistoryRow; clock: string; canOperate: boolean; showStore: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pendingSettle, startSettle] = useTransition();
  const { toast } = useToast();
  const open = isOpenSession(row);
  const status = historyStatusLabel(row, clock);

  const reprint = () =>
    startTransition(async () => {
      try {
        const r = await reprintRegisterReport(row.id);
        if (!r.ok) return toast(r.error, 'error');
        toast(open ? '途中集計の精算レシートを印刷しています' : 'レジ精算レシートを印刷しています');
      } catch (err) {
        toast(toUserMessage(err, '印刷に失敗しました'), 'error');
      }
    });
  const settlement = () =>
    startSettle(async () => {
      try {
        const r = await printSettlementReport(row.id);
        if (!r.ok) return toast(r.error, 'error');
        toast('精算情報を印刷しています');
      } catch (err) {
        toast(toUserMessage(err, '印刷に失敗しました'), 'error');
      }
    });

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-navy">{mdWeekdayLabel(row.businessDate)}</span>
          <span className="text-sm font-semibold text-navy">{row.registerName}</span>
          {showStore && row.storeName && <span className="text-xs text-gray-500">{row.storeName}</span>}
          <Badge tone={status.tone === 'danger' ? 'danger' : status.tone === 'warn' ? 'warning' : 'gray'}>{status.ja}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          開局 {formatDateTime(row.openedAt)}｜担当 {row.openedByName}
          {row.closedAt && (
            <>
              ｜締め {formatDateTime(row.closedAt)}｜締め担当 {row.closedByName}
            </>
          )}
          {!open && row.difference != null && (
            <span className={row.difference !== 0 ? 'text-danger' : undefined}>
              ｜差異 {row.difference > 0 ? '+' : ''}
              {yen(row.difference)}
            </span>
          )}
        </p>
      </div>
      {canOperate && (
        <div className="flex flex-wrap items-center gap-2">
          {open && !showStore && (
            <Link href="/app/cash/close" className={cn(buttonVariants({ variant: status.tone === 'danger' ? 'danger' : 'primary', size: 'sm' }))}>
              <Lock className="h-4 w-4" />
              レジ精算をする / Close
            </Link>
          )}
          {!open && (
            <Button type="button" variant="ghost" size="sm" onClick={settlement} disabled={pendingSettle}>
              <Printer className="h-4 w-4" />
              {pendingSettle ? '印刷中…' : '精算情報'}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={reprint} disabled={pending}>
            <Printer className="h-4 w-4" />
            {pending ? '印刷中…' : open ? '途中集計を印刷' : '精算レシートを印刷'}
          </Button>
        </div>
      )}
    </li>
  );
}
