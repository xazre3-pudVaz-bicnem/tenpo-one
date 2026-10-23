'use client';

/**
 * レジ（iPad）ホームの真ん中：本日の達成率の丸・実績売上高・客単価・予算売上高（Target）。
 * 点線を横に通し、上の段に 店舗分析、下の段に 予算登録（どちらも白いボタン・点線から同じ距離）。
 * 金額と丸は オーダー・会計 と同じ濃い青（2026-10-19 Ronnie の新しいレイアウト）。
 */
import { useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { SalesDayView } from '@/lib/register-day';

const BLUE_FROM = '#2a6fe6';
const BLUE_TO = '#0a3fa8';
/** 売上の自動更新の間隔（1分） */
const AUTO_REFRESH_MS = 60_000;
const R = 62;
const C = 2 * Math.PI * R;

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const num = { fontFamily: 'var(--font-manrope)' } as const;
const blueText = {
  ...num,
  backgroundImage: `linear-gradient(180deg, ${BLUE_FROM}, ${BLUE_TO})`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

function Label({ ja, en }: { ja: string; en: string }) {
  return (
    <span className="block leading-tight">
      <span className="block text-[13px] whitespace-nowrap text-[#6e6e73]">{ja}</span>
      <span className="block text-[10px] text-[#8e8e93]" style={num}>
        {en}
      </span>
    </span>
  );
}

function WhiteButton({ href, ja, en }: { href: string; ja: string; en: string }) {
  return (
    <Link
      href={href}
      className="block min-w-[112px] shrink-0 rounded-xl lg:min-w-[150px] bg-white px-[18px] py-2.5 text-center leading-tight text-[#1c1c1e] shadow-[inset_0_0_0_1px_#d1d1d6] active:bg-[#f2f2f7]"
    >
      <b className="block text-[15px]">{ja}</b>
      <span className="text-[10px] text-[#8e8e93]" style={num}>
        {en}
      </span>
    </Link>
  );
}

export function RegiSales({
  actual,
  avgSpend,
  budget,
  pct,
  ringPct,
  asOf,
  canAnalytics,
  day,
}: {
  actual: number;
  avgSpend: number;
  budget: number | null;
  pct: number | null;
  ringPct: number;
  /** 'YYYY/MM/DD HH:MM' */
  asOf: string;
  /** 店舗分析・予算登録を出すか（reports.view） */
  canAnalytics: boolean;
  /** 売上を出す営業日（2026-10-22 Ronnie「レジの営業日で出す」）。今日でなければ「10/22（木）の売上」。省略時は本日 */
  day?: SalesDayView;
}) {
  const dayLabel = day?.dayLabel ?? '本日';
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // 実績売上高は1分ごとに自動で新しくする（2026-10-20 Ronnie）。画面が見えていないときは止め、戻ったらすぐ新しくする
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    };
    const id = setInterval(refresh, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  const ring = Math.max(0, Math.min(100, ringPct));

  return (
    <section aria-label={`${dayLabel}の売上`} className="flex flex-1 items-center gap-5 px-1 py-2 lg:gap-8 lg:px-3.5">
      <div className="relative h-[136px] w-[136px] shrink-0 lg:h-[176px] lg:w-[176px]">
        <svg viewBox="0 0 150 150" aria-hidden="true" className="h-full w-full">
          <defs>
            <linearGradient id="regi-ring" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={BLUE_FROM} />
              <stop offset="1" stopColor={BLUE_TO} />
            </linearGradient>
          </defs>
          <circle cx="75" cy="75" r={R} fill="none" stroke="#e5e5ea" strokeWidth="14" />
          {ring > 0 && (
            <circle
              cx="75"
              cy="75"
              r={R}
              fill="none"
              stroke="url(#regi-ring)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${(C * ring) / 100} ${C}`}
              transform="rotate(-90 75 75)"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-[28px] leading-none font-extrabold text-[#1c1c1e] lg:text-[34px]" style={num}>
            {pct != null ? pct : '—'}
            <small className="text-[17px]">%</small>
          </b>
          <span className="mt-1 text-[11px] text-[#6e6e73]">{dayLabel}の達成率</span>
          <span className="text-[9px] text-[#8e8e93]" style={num}>
            Budget
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-end justify-between gap-5 pb-[18px]">
          <div className="min-w-0">
            <Label ja={day?.heading ?? '実績売上高'} en="Sales" />
            {day?.note && <span className="block text-[11px] text-[#8e8e93]">{day.note}</span>}
            <div className="text-[38px] leading-[1.1] font-extrabold tracking-[-0.01em] whitespace-nowrap tabular-nums lg:text-[52px]" style={blueText}>
              {yen(actual)}
            </div>
            <div className="text-[13px] text-[#6e6e73]">
              客単価{' '}
              <b className="tabular-nums" style={{ ...num, color: '#0f4fc4' }}>
                {yen(avgSpend)}
              </b>
            </div>
          </div>
          {canAnalytics && <WhiteButton href="/app/reports" ja="店舗分析" en="Analytics" />}
        </div>
        <div className="flex items-start justify-between gap-5 border-t-[1.5px] border-dashed border-[#d1d1d6] pt-[16.5px]">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <Label ja="予算売上高" en="Target" />
              <b className="text-[20px] font-extrabold whitespace-nowrap text-[#1c1c1e] tabular-nums lg:text-[24px]" style={num}>
                {budget != null ? yen(budget) : '—'}
              </b>
            </div>
            <button
              type="button"
              aria-label="売上を更新"
              disabled={pending}
              onClick={() => startTransition(() => router.refresh())}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[#8e8e93] tabular-nums disabled:opacity-60"
              style={num}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8e8e93"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={cn(pending && 'animate-spin')}
              >
                <path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M3 4v5h5M4 13a8 8 0 0 0 14.6 4.5L21 15M21 20v-5h-5" />
              </svg>
              {asOf}
            </button>
          </div>
          {canAnalytics && <WhiteButton href="/app/budgets" ja="予算登録" en="Set budget" />}
        </div>
      </div>
    </section>
  );
}
