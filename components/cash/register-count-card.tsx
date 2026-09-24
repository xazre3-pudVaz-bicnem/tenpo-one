'use client';

import { useMemo, useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { closeRegister } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';
import { hasAnyCount, sumDenominations, type DenominationCounts } from '@/lib/cash-count';
import { denominationsToJson } from '@/lib/register-report';
import { CashDenominationCounter } from '@/components/cash/cash-denomination-counter';
import { useClerkGate } from '@/components/pos/clerk-gate';
import { signOutRegister } from '@/app/app/actions';

export interface CountSession {
  id: string;
  registerName: string;
  /** このセッションの営業日。当日と違えば前営業日から開きっぱなし */
  businessDate?: string;
  openingFloat: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  theoreticalCash: number;
}

/**
 * 現金実査（プロトタイプの close 右カード）。理論在高と実査額の差額を見てクローズする。
 * 締め処理は既存の closeRegister（close_register_session RPC）をそのまま呼ぶ。差額がある場合は理由必須。
 * 金種別の枚数も一緒に保存し、締めと同時にレジ精算レシートがレシートプリンターから出る。
 */
export function RegisterCountCard({
  session,
  showRegisterName,
  canOperate,
  today,
}: {
  session: CountSession;
  showRegisterName: boolean;
  canOperate: boolean;
  /** 当日の営業日。session.businessDate と違えば「前営業日から開きっぱなし」として警告する */
  today?: string;
}) {
  // 金種別に数えた枚数。合計がそのまま実査額になる（電卓で足し算しなくてよい）
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const clerkGate = useClerkGate();

  const entered = hasAnyCount(counts);
  const countedValue = useMemo(() => sumDenominations(counts), [counts]);
  const diff = entered ? countedValue - session.theoreticalCash : null;
  const needsReason = diff != null && diff !== 0;

  const handleClose = () => {
    if (!entered) {
      toast('金種ごとの枚数を入力してください（0円のときは1円に0と入れてください）', 'error');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('差額がある場合は理由を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const result = await closeRegister(
          session.id,
          countedValue,
          needsReason ? reason.trim() : null,
          denominationsToJson(counts),
          clerkGate?.clerk?.name ?? null
        );
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        if (result.printWarning) {
          toast(`${session.registerName}をクローズしました。${result.printWarning}`, 'error');
        } else {
          toast(`${session.registerName}をクローズしました。レジ精算レシートを印刷しています`);
        }
        setCounts({});
        setReason('');
        // レジ端末は締めたらログアウト（レジのログイン画面へ戻る）
        if (result.signOutAfter) await signOutRegister();
      } catch (err) {
        toast(toUserMessage(err, 'クローズに失敗しました'), 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="Cash count">現金実査{showRegisterName ? ` — ${session.registerName}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {/* 前営業日から開きっぱなしのレジ。これを締めないと、そのレジは新しく開局できない */}
        {today && session.businessDate && session.businessDate !== today && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            このレジは <span className="font-bold">{session.businessDate}</span>{' '}
            の営業日から開いたままです。先にこのレジを締めてください（締めるまで、このレジは新しく開局できません）。
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-b border-line py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">理論在高</p>
            <p className="text-xs text-ink-3">釣銭準備金 ＋ 現金売上 ＋ 入金 − 出金 − 現金返金</p>
            <p className="mt-1 text-[11px] text-ink-3 tabular-nums">
              {yen(session.openingFloat)} ＋ {yen(session.cashSales)} ＋ {yen(session.cashIn)} − {yen(session.cashOut)}
              {session.cashRefunds > 0 && ` − ${yen(session.cashRefunds)}`}
            </p>
          </div>
          <b className="shrink-0 text-xl font-extrabold text-ink tabular-nums">{yen(session.theoreticalCash)}</b>
        </div>

        <div className="border-b border-line py-4">
          <p className="mb-2 text-sm font-medium text-ink">実査額（数えた現金）</p>
          <CashDenominationCounter
            idPrefix={`count-${session.id}`}
            counts={counts}
            onChange={setCounts}
            disabled={!canOperate}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line py-4">
          <span className="text-sm font-medium text-ink">差額</span>
          <b
            className={cn(
              'text-xl font-extrabold tabular-nums',
              diff == null ? 'text-ink' : diff === 0 ? 'text-success' : 'text-danger'
            )}
          >
            {diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${yen(Math.abs(diff))}`}
          </b>
        </div>

        {needsReason && (
          <div className="border-b border-line py-3">
            <label htmlFor={`diff-reason-${session.id}`} className="mb-1 block text-sm font-medium text-danger">
              差額の理由（必須）
            </label>
            <Textarea
              id={`diff-reason-${session.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：釣銭の渡し間違い／レシートのない出金"
            />
          </div>
        )}

        {canOperate ? (
          <Button
            size="lg"
            variant={needsReason ? 'danger' : 'primary'}
            className="mt-4 w-full"
            onClick={handleClose}
            disabled={pending || (needsReason && !reason.trim())}
          >
            {pending ? 'クローズ中…' : 'レジをクローズする / Close register'}
          </Button>
        ) : (
          <p className="mt-4 text-center text-xs text-ink-3">レジ操作の権限がありません</p>
        )}
        {canOperate && (
          <p className="mt-2 text-center text-[11px] text-ink-3">
            クローズすると、本日の売上・支払方法別・現金精算・入出金をまとめたレジ精算レシートがレシートプリンターから印刷されます
          </p>
        )}
      </CardContent>
    </Card>
  );
}
