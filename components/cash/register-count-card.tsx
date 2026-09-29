'use client';

import Link from 'next/link';

import { useMemo, useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { AlertTriangle, Lock } from 'lucide-react';
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
import { closePlan } from '@/lib/register-day';

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
  openSlipCount = 0,
  nextFloatTarget,
  denominationColumns = 1,
}: {
  session: CountSession;
  showRegisterName: boolean;
  canOperate: boolean;
  /** 当日の営業日。session.businessDate と違えば「前営業日から開きっぱなし」として警告する */
  today?: string;
  /** 未会計の伝票の数。1枚でも残っていたらクローズさせない（2026-09-25 店舗要望） */
  openSlipCount?: number;
  /** 翌準備金の目標（店舗設定、無ければ その日の釣銭準備金）。2026-09-28 Ronnie */
  nextFloatTarget?: number;
  /** 金種の表を2列に（レジの iPad で1画面に収める。2026-09-29 Ronnie） */
  denominationColumns?: 1 | 2;
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
  /** 数えた現金の分け方：翌準備金（レジに残す）・預入金（銀行・預り金）・準備金不足 */
  const plan = entered
    ? closePlan({ counted: countedValue, openingFloat: session.openingFloat, nextFloatSetting: nextFloatTarget ?? null })
    : null;
  /** レジクローズの担当者（必ず選ぶ。精算レシートに出る） */
  const clerkName = clerkGate?.clerk?.name ?? null;
  const blocked = openSlipCount > 0 || !entered || diff !== 0 || !clerkName;
  /**
   * 締められない理由（日本語と英語）。押したときにポップアップで出す
   * （2026-09-29 Ronnie「レジクローズで間違いがあったら、何が間違いか日本語と英語で出るポップアップを」）。
   * 差額があるままでは締められない（2026-09-25 店舗要望「レジの金額合わないとできない」）。
   */
  const problems: CloseProblem[] = [];
  if (openSlipCount > 0) {
    problems.push({
      ja: `未会計の伝票が${openSlipCount}件あります。すべて会計するか取消してからクローズしてください。`,
      en: `There ${openSlipCount === 1 ? 'is 1 unpaid slip' : `are ${openSlipCount} unpaid slips`}. Please check out or cancel them before closing.`,
    });
  }
  if (!entered) {
    problems.push({
      ja: '金種ごとの枚数を入れてください（0円のときは1円に0と入れてください）。',
      en: 'Please enter the number of coins and bills for each denomination (enter 0 for ¥1 if there is no cash).',
    });
  } else if (diff !== 0 && diff != null) {
    problems.push({
      ja: `数えた現金が理論在高より ${yen(Math.abs(diff))} ${diff > 0 ? '多い' : '少ない'}です。数え直すか、差額を入出金に記録して合わせてください。`,
      en: `The counted cash is ${yen(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the expected cash. Please count again, or record the difference in Cash in / out.`,
    });
  }
  if (!clerkName) {
    problems.push({
      ja: 'レジクローズの担当者を選んでください。',
      en: 'Please select the staff member who is closing the register.',
    });
  }
  const [problemPopup, setProblemPopup] = useState<CloseProblem[] | null>(null);

  const handleClose = () => {
    if (problems.length > 0) {
      setProblemPopup(problems);
      return;
    }
    if (!clerkName) return;
    startTransition(async () => {
      try {
        const result = await closeRegister(
          session.id,
          countedValue,
          reason.trim() || null,
          denominationsToJson(counts),
          clerkName
        );
        if (!result.ok) {
          setProblemPopup([{ ja: result.error, en: 'The register could not be closed. Please check the message above and try again.' }]);
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
        setProblemPopup([
          { ja: toUserMessage(err, 'クローズに失敗しました'), en: 'The register could not be closed. Please try again.' },
        ]);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="Cash count">現金実査{showRegisterName ? ` — ${session.registerName}` : ''}</CardTitle>
        {/* 上にも「レジクローズする」（2026-09-29 Ronnie）。下のボタンと同じ働き・同じ条件 */}
        {canOperate && (
          <Button
            size="sm"
            variant={needsReason ? 'danger' : 'primary'}
            onClick={handleClose}
            disabled={pending}
            className={cn('h-auto flex-col gap-0 py-1 leading-tight', blocked && 'opacity-60')}
          >
            {pending ? 'クローズ中…' : 'レジクローズする'}
            <span className="text-[10px] font-semibold opacity-80">Close register</span>
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3 sm:px-4">
        {/* 前営業日から開きっぱなしのレジ。これを締めないと、そのレジは新しく開局できない */}
        {today && session.businessDate && session.businessDate !== today && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            このレジは <span className="font-bold">{session.businessDate}</span>{' '}
            の営業日から開いたままです。先にこのレジを締めてください（締めるまで、このレジは新しく開局できません）。
          </p>
        )}
        {/* レジオープン金額（開局のときに数えた釣銭準備金）。ここでは変えられない（2026-09-29 Ronnie） */}
        <div className="flex items-center justify-between gap-3 border-b border-line py-2">
          <p className="text-sm font-medium text-ink">
            レジオープン金額<span className="ml-1 text-[11px] text-ink-3">Opening cash</span>
          </p>
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-ink-3" aria-label="変更できません" />
            <b className="text-base font-extrabold text-ink tabular-nums">{yen(session.openingFloat)}</b>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-line py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">理論在高</p>
            <p className="text-xs text-ink-3">釣銭準備金 ＋ 現金売上 ＋ 入金 − 出金 − 現金返金</p>
            <p className="mt-1 text-[11px] text-ink-3 tabular-nums">
              {yen(session.openingFloat)} ＋ {yen(session.cashSales)} ＋ {yen(session.cashIn)} − {yen(session.cashOut)}
              {session.cashRefunds > 0 && ` − ${yen(session.cashRefunds)}`}
            </p>
          </div>
          <b className="shrink-0 text-lg font-extrabold text-ink tabular-nums">{yen(session.theoreticalCash)}</b>
        </div>

        <div className="border-b border-line py-2.5">
          <p className="mb-1.5 text-sm font-medium text-ink">実査額（数えた現金）</p>
          {/* 開局の箱と同じ小さい形（2026-09-29 Ronnie「この箱も小さく」） */}
          <CashDenominationCounter
            idPrefix={`count-${session.id}`}
            counts={counts}
            onChange={setCounts}
            disabled={!canOperate}
            compact
            columns={denominationColumns}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line py-2">
          <span className="text-sm font-medium text-ink">差額</span>
          <b
            className={cn(
              'text-lg font-extrabold tabular-nums',
              diff == null ? 'text-ink' : diff === 0 ? 'text-success' : 'text-danger'
            )}
          >
            {diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${yen(Math.abs(diff))}`}
          </b>
        </div>

        {/* 数えた現金の分け方（2026-09-28 Ronnie「現金売上で買い物の分が戻れば、残りは銀行・預り金。足りなければマイナス」） */}
        <div className="space-y-1 border-b border-line py-2 text-sm">
          <p className="flex items-center justify-between gap-3">
            <span className="text-ink-2">
              翌準備金<span className="ml-1 text-[11px] text-ink-3">明日レジに残す</span>
            </span>
            <b className="tabular-nums text-ink">{plan ? yen(plan.nextFloat) : '—'}</b>
          </p>
          <p className="flex items-center justify-between gap-3">
            <span className="text-ink-2">
              預入金<span className="ml-1 text-[11px] text-ink-3">銀行・預り金へ</span>
            </span>
            <b className={cn('tabular-nums', plan && plan.deposit > 0 ? 'text-royal' : 'text-ink')}>{plan ? yen(plan.deposit) : '—'}</b>
          </p>
          {plan && plan.shortage > 0 && (
            <p className="flex items-center justify-between gap-3 font-bold text-danger">
              <span>準備金不足（マイナス）</span>
              <b className="tabular-nums">−{yen(plan.shortage)}</b>
            </p>
          )}
          <p className="text-[11px] text-ink-3">
            目標 {yen(nextFloatTarget ?? session.openingFloat)}（{nextFloatTarget != null && nextFloatTarget !== session.openingFloat ? '店舗設定' : '今日の釣銭準備金と同じ'}）
          </p>
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

        {/* 締められない理由（2026-09-25 店舗要望の3つのルール） */}
        {blocked && (
          <ul className="mt-3 space-y-1 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2.5 text-[13px] font-bold text-danger">
            {openSlipCount > 0 && (
              <li>
                未会計の伝票が{openSlipCount}件あります。すべて会計するか取消してください
                <Link href="/app/orders?status=open" className="ml-1.5 underline">
                  未会計を見る
                </Link>
              </li>
            )}
            {!entered && <li>金種ごとの枚数を入れてください</li>}
            {entered && diff !== 0 && (
              <li>
                実査額が理論在高と {yen(Math.abs(diff ?? 0))} {(diff ?? 0) > 0 ? '多い' : '少ない'}です。
                数え直すか、差額を入出金に記録して合わせてください
                <Link href="/app/cash" className="ml-1.5 underline">
                  入出金へ
                </Link>
              </li>
            )}
            {!clerkName && (
              <li>
                レジクローズの担当者を選んでください
                <button type="button" onClick={() => clerkGate?.change()} className="ml-1.5 underline">
                  担当者を選ぶ
                </button>
              </li>
            )}
          </ul>
        )}
        {clerkName && (
          <p className="mt-3 text-center text-[12px] text-ink-3">
            レジクローズ担当者 <b className="text-navy">{clerkName}</b>
          </p>
        )}
        {canOperate ? (
          <Button
            size="lg"
            variant={needsReason ? 'danger' : 'primary'}
            className={cn('mt-3 w-full', blocked && 'opacity-60')}
            onClick={handleClose}
            disabled={pending}
          >
            <span className="flex flex-col items-center leading-tight">
              {pending ? 'クローズ中…' : 'レジをクローズする'}
              <span className="text-[11px] font-semibold opacity-80">Close register</span>
            </span>
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
      {/* 締められないとき・失敗したときのポップアップ（日本語と英語） */}
      <Dialog open={problemPopup !== null} onClose={() => setProblemPopup(null)} title="レジクローズできません / Cannot close the register">
        <ul className="space-y-3">
          {(problemPopup ?? []).map((p, i) => (
            <li key={i} className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <span>
                <span className="block text-[14px] font-bold text-danger">{p.ja}</span>
                <span className="mt-0.5 block text-[12px] text-ink-2">{p.en}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {!clerkName && clerkGate && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setProblemPopup(null);
                clerkGate.change();
              }}
            >
              担当者を選ぶ / Select staff
            </Button>
          )}
          <Button type="button" onClick={() => setProblemPopup(null)}>
            OK
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

interface CloseProblem {
  ja: string;
  en: string;
}
