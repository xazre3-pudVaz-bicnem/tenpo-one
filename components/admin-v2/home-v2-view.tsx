import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import type { HomeStoreRow, HourlyCompare } from '@/lib/home-v2';
import { HourlyCompareChart } from './hourly-compare-chart';
import { StoreSwitchLink } from './store-switch-link';

export interface HomeV2Todo {
  key: string;
  label: string;
  sub?: string;
  href: string;
  linkLabel: string;
  tone: 'warn' | 'info';
}

export interface HomeV2Props {
  scopeLabel: string;
  asOf: string;
  kpi: {
    sales: number;
    settled: number;
    open: number;
    guests: number;
    groups: number;
    avgSpend: number;
    dailyBudget: number | null;
    achievementPct: number | null;
  };
  rows: HomeStoreRow[];
  todos: HomeV2Todo[];
  hourly: HourlyCompare;
  nowHour: number;
}

const ROW_GRID =
  'grid grid-cols-[minmax(180px,1.7fr)_minmax(120px,1.1fr)_minmax(110px,1fr)_minmax(130px,1fr)_minmax(100px,0.9fr)_minmax(64px,0.6fr)_20px] items-center gap-3';

/**
 * 新しい管理画面のホーム（2026-10-10 Ronnie「シンプルに、管理画面のスタイルで」）。
 * 上：本日の4つの数字／真ん中：店舗の一覧（押すと店舗ナウ）／下：やること・時間帯別の売上。
 */
export function HomeV2View({ scopeLabel, asOf, kpi, rows, todos, hourly, nowHour }: HomeV2Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-black text-ink">ホーム</h1>
          <p className="text-[13px] text-ink-2">
            {asOf} 時点・{scopeLabel}
          </p>
        </div>
        <Link
          href="/app/reports"
          className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-bold text-royal hover:border-wisteria"
        >
          期間を選んで見る（レポート）
        </Link>
      </div>

      <section aria-label="本日の数字" className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="本日の売上（税込）" value={yen(kpi.sales)} sub={`会計済 ${yen(kpi.settled)}・未会計 ${yen(kpi.open)}`} href="/app/orders" />
        <Kpi label="客数（会計済み）" value={`${kpi.guests}`} unit="人" sub={`会計 ${kpi.groups}件`} href="/app/orders" />
        <Kpi label="客単価" value={yen(kpi.avgSpend)} sub="本日の売上 ÷ 客数" href="/app/reports" />
        <div className="flex flex-col gap-2 bg-white px-5 py-4">
          <span className="text-[12.5px] text-ink-2">予算の達成</span>
          {kpi.achievementPct != null && kpi.dailyBudget ? (
            <>
              <span className="text-[28px] leading-tight font-extrabold text-ink tabular-nums">
                {kpi.achievementPct}
                <span className="ml-0.5 text-[15px]">%</span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-lilac">
                <div className="h-full rounded-full bg-iris" style={{ width: `${Math.min(100, kpi.achievementPct)}%` }} />
              </div>
              <span className="text-xs text-ink-3">本日の予算 {yen(kpi.dailyBudget)}</span>
            </>
          ) : (
            <>
              <span className="text-[22px] leading-tight font-extrabold text-ink-3">予算未設定</span>
              <Link href="/app/budgets" className="text-xs font-bold text-royal hover:underline">
                予算を登録する ›
              </Link>
            </>
          )}
        </div>
      </section>

      <section aria-label="店舗" className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
          <h2 className="text-base font-extrabold text-ink">店舗</h2>
          <span className="text-[12.5px] text-ink-3">店舗を押すと、どの卓に誰がいるか・予約まで見られます（店舗ナウ）</span>
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-[780px] flex-col">
            <div className={cn(ROW_GRID, 'border-y border-line bg-lilac-soft px-5 py-2 text-xs text-ink-3')}>
              <span>店舗</span>
              <span>いまの席</span>
              <span>未会計</span>
              <span>本日の予約</span>
              <span className="text-right">本日の売上</span>
              <span className="text-right">予算</span>
              <span />
            </div>
            {rows.map((r) => (
              <StoreSwitchLink
                key={r.id}
                storeId={r.id}
                href={`/app/now?store=${r.id}`}
                className={cn(ROW_GRID, 'w-full border-b border-line/70 px-5 py-3.5 text-left text-[13.5px] text-ink last:border-b-0 hover:bg-lilac-soft disabled:opacity-60')}
              >
                <b className="truncate">{r.name}</b>
                <span className="flex flex-col gap-1">
                  <span className="font-bold tabular-nums">
                    {r.tablesUsed} / {r.tablesTotal} 卓
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-lilac">
                    <span
                      className="block h-full bg-iris"
                      style={{ width: `${r.tablesTotal > 0 ? Math.round((r.tablesUsed / r.tablesTotal) * 100) : 0}%` }}
                    />
                  </span>
                </span>
                <span className="flex flex-col">
                  <span className="font-bold">{r.openCount}組</span>
                  <span className="text-xs text-ink-2 tabular-nums">{yen(r.openTotal)}</span>
                </span>
                <span className="flex flex-col">
                  <span className="font-bold">
                    {r.resvGroups}組 {r.resvGuests}名
                  </span>
                  <span className={cn('text-xs', r.nextTime ? 'font-bold text-royal' : 'text-ink-3')}>
                    {r.nextTime ? `次 ${r.nextTime}・あと${r.resvUpcoming}組` : r.resvGroups > 0 ? 'このあとの予約なし' : '—'}
                  </span>
                </span>
                <span className="text-right font-extrabold tabular-nums">{yen(r.sales)}</span>
                <span className={cn('text-right font-bold tabular-nums', r.budgetPct != null && r.budgetPct < 70 && 'text-danger')}>
                  {r.budgetPct != null ? `${r.budgetPct}%` : '—'}
                </span>
                <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
              </StoreSwitchLink>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-label="やること" className="flex min-w-0 flex-[1_1_340px] flex-col rounded-xl border border-line bg-white px-5 py-4">
          <h2 className="mb-1.5 text-base font-extrabold text-ink">やること</h2>
          {todos.length === 0 ? (
            <p className="border-t border-line py-3 text-sm text-ink-3">いま、やることはありません</p>
          ) : (
            todos.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className="flex items-center gap-3 border-t border-line/70 py-2.5 text-[13.5px] text-ink hover:text-royal"
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', t.tone === 'warn' ? 'bg-saffron' : 'bg-iris')} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{t.label}</span>
                  {t.sub && <span className="text-xs text-ink-3">{t.sub}</span>}
                </span>
                <span className="shrink-0 text-[12.5px] font-bold text-royal">{t.linkLabel}</span>
              </Link>
            ))
          )}
        </section>
        <section aria-label="売上の動き" className="flex min-w-0 flex-[2_1_520px] flex-col gap-2 rounded-xl border border-line bg-white px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-extrabold text-ink">
              売上の動き<span className="ml-2 text-[12.5px] font-normal text-ink-3">時間帯別</span>
            </h2>
            <div className="flex gap-3.5 text-xs text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[11px] w-[11px] rounded-[3px] bg-iris" aria-hidden />
                本日
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block w-4 border-t-[2.5px] border-dashed border-[#d4891c]" aria-hidden />
                前週の同じ曜日
              </span>
            </div>
          </div>
          <HourlyCompareChart data={hourly} nowHour={nowHour} />
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, sub, href }: { label: string; value: string; unit?: string; sub: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-1.5 bg-white px-5 py-4 hover:bg-lilac-soft">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className="text-[28px] leading-tight font-extrabold text-ink tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[15px]">{unit}</span>}
      </span>
      <span className="text-xs text-ink-3">{sub}</span>
    </Link>
  );
}
