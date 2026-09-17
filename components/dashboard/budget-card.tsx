'use client';

/**
 * 予算達成率カード（プロトタイプの .card.budget）。
 * 実績 = 本日の会計済み純売上 + 未会計の注文合計。予算 = 月予算（/app/budgets）の日割り。
 * 「(時点)」はサーバー描画時刻。再読込ボタンで router.refresh() する。
 */
import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R;

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

export function BudgetCard({
  actual,
  openSales,
  budget,
  pct,
  ringPct,
  asOf,
  className,
}: {
  actual: number;
  openSales: number;
  budget: number | null;
  pct: number | null;
  ringPct: number;
  /** 'YYYY/MM/DD HH:MM' */
  asOf: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hasBudget = budget != null && pct != null;

  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle en="Budget">予算達成率</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/budgets" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
            予算登録<span className="en-inline -ml-1">Set</span>
          </Link>
          <Link href="/app/reports" className={buttonVariants({ variant: 'primary', size: 'md' })}>
            店舗分析
            <span className="en-inline -ml-1" style={{ color: 'rgba(255,255,255,.82)' }}>
              Analytics
            </span>
          </Link>
        </div>
      </CardHeader>

      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-7 gap-y-5 px-6 py-[18px]">
        <div className="relative h-[168px] w-[168px] shrink-0" role="img" aria-label={hasBudget ? `本日の予算達成率 ${pct}%` : '予算未設定'}>
          <svg viewBox="0 0 120 120" className="h-full w-full">
            <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--color-lilac)" strokeWidth="14" />
            {hasBudget && ringPct > 0 && (
              <circle
                cx="60"
                cy="60"
                r={RING_R}
                fill="none"
                stroke="var(--color-iris)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={RING_C.toFixed(2)}
                strokeDashoffset={(RING_C * (1 - ringPct / 100)).toFixed(2)}
                transform="rotate(-90 60 60)"
                className="transition-[stroke-dashoffset] duration-700 ease-out"
              />
            )}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <span>
              {hasBudget ? (
                <b className="block text-[36px] leading-none font-extrabold text-royal tabular-nums">
                  {pct}
                  <span className="text-[26px]">%</span>
                </b>
              ) : (
                <b className="block text-[26px] leading-none font-extrabold text-ink-3 tabular-nums">—%</b>
              )}
              <small className="mt-[5px] block text-[11px] leading-snug text-ink-3">本日の達成率</small>
            </span>
          </div>
        </div>

        <dl className="m-0 flex min-w-[150px] flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1 border-b border-dashed border-line pb-2.5">
            <dt className="text-[13px] font-medium text-ink-2">
              実績売上高<span className="en-inline">Sales</span>
            </dt>
            <dd className="m-0 text-[31px] leading-none font-bold text-saffron tabular-nums">{yen(actual)}</dd>
          </div>
          <div className="flex flex-col gap-1 border-b border-dashed border-line pb-2.5">
            <dt className="text-[13px] font-medium text-ink-2">
              予算売上高<span className="en-inline">Target</span>
            </dt>
            {budget != null ? (
              <dd className="m-0 text-[26px] leading-none font-bold text-ink tabular-nums">{yen(budget)}</dd>
            ) : (
              <dd className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-bold text-ink-3">
                予算が未設定です
                <Link href="/app/budgets" className="text-[13px] text-iris hover:underline">
                  予算を登録する ›
                </Link>
              </dd>
            )}
          </div>
          <p className="m-0 text-[11.5px] text-ink-3">
            ※実績売上高には未会計分の金額が含まれています
            {openSales > 0 && <span className="tabular-nums">（未会計 {yen(openSales)}）</span>}
            {budget != null && <span>。予算は月予算の日割りです</span>}
          </p>
        </dl>
      </div>

      <footer className="flex items-center justify-between gap-3 px-5 pt-2 pb-3.5 text-xs text-ink-3 tabular-nums">
        <span>（{asOf}時点）</span>
        <button
          type="button"
          aria-label="実績売上高を更新"
          title="更新"
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
          className="grid h-9 w-9 place-items-center rounded-[9px] border border-line bg-white text-ink-2 transition-colors hover:border-iris hover:text-iris disabled:opacity-60"
        >
          <RefreshCw className={cn('h-[18px] w-[18px]', pending && 'animate-spin')} />
        </button>
      </footer>
    </Card>
  );
}
