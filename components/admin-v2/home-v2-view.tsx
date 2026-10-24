import Link from 'next/link';
import { CalendarDays, ChevronRight, JapaneseYen, LayoutGrid, Receipt, Repeat, RotateCw, Target, User, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import type { HomeStoreRow, HourlyCompare } from '@/lib/home-v2';
import { HOME_CARDS, delta, homeHref, rangeLabel, type DateRange, type HomeCard, type HomeCompare, type HomeRange } from '@/lib/home-period';
import type { HomeExtras, PeriodKpi, PeriodStoreRow } from '@/lib/home-period-server';
import { HourlyCompareChart } from './hourly-compare-chart';
import { HomePeriodBar } from './home-period-bar';
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
  period: { range: HomeRange; compare: HomeCompare; current: DateRange; previous: DateRange; card: HomeCard };
  kpi: { current: PeriodKpi; previous: PeriodKpi };
  /** 数字の下に並べる比較（期間に合うものを全部。lib/home-period.ts comparesFor） */
  compareKpis: { key: HomeCompare; range: DateRange; kpi: PeriodKpi }[];
  /** 客席回転率・リピート率・支払い方法・ベストセラー（2026-10-24 funfo のダッシュボードから） */
  extras: HomeExtras;
  /** リピート率の見出しの下の説明（本日は「初回来店が前の人」、期間は「期間内に 2 回以上」） */
  repeatNote: string;
  /** 本日：いまの席・未会計・本日の予約つきの店舗一覧 */
  rows: HomeStoreRow[] | null;
  /** 本日以外：期間の売上・客数・客単価・予算の店舗一覧 */
  periodRows: PeriodStoreRow[] | null;
  todos: HomeV2Todo[];
  hourly: HourlyCompare;
  /** いまの時（期間に今日が入るときだけ。棒を薄く・縦線） */
  nowHour: number | null;
}

const ROW_GRID =
  'grid grid-cols-[minmax(180px,1.7fr)_minmax(120px,1.1fr)_minmax(110px,1fr)_minmax(130px,1fr)_minmax(100px,0.9fr)_minmax(64px,0.6fr)_20px] items-center gap-3';
const PERIOD_ROW_GRID =
  'grid grid-cols-[minmax(180px,1.7fr)_minmax(110px,1fr)_minmax(90px,0.8fr)_minmax(90px,0.8fr)_minmax(100px,0.9fr)_minmax(120px,1fr)_20px] items-center gap-3';

const COMPARE_LABEL: Record<HomeCompare, string> = { day: '前日比', week: '前週同曜日比', month: '前月同日比', year: '前年同期比' };

interface CompareLine {
  label: string;
  /** 比べる期間（マウスを乗せたとき） */
  title: string;
  d: ReturnType<typeof delta>;
  prevText: string;
}

/** 数字のアイコンの色（2026-10-24 Ronnie「iPad の機能と同じ色で」：iPad のホームの 来店組数・客数・リピーター・ウォークイン と同じ） */
const TONE = {
  sales: 'linear-gradient(180deg,#2a6fe6,#0a3fa8)',
  groups: 'linear-gradient(180deg,#4a9bff,#1f6fe0)',
  guests: 'linear-gradient(180deg,#7b74f0,#5147d6)',
  repeat: 'linear-gradient(180deg,#ff8a7a,#e5584a)',
  walkIn: 'linear-gradient(180deg,#ffa53a,#f08a10)',
  cash: 'linear-gradient(180deg,#3fbf63,#1a8a3e)',
  gray: 'linear-gradient(180deg,#7c7c80,#48484a)',
} as const;

/**
 * 新しい管理画面のホーム（2026-10-10 Ronnie「シンプルに、管理画面のスタイルで」）。
 * 上：期間タブと比較（2026-10-24 funfo・dinii のおすすめ）／数字 4 つ（増減つき）／店舗の一覧／やること・時間帯別の売上。
 */
export function HomeV2View({ scopeLabel, asOf, period, kpi, compareKpis, extras, repeatNote, rows, periodRows, todos, hourly, nowHour }: HomeV2Props) {
  const cur = kpi.current;
  const isToday = period.range === 'today';
  const periodTitle = isToday ? '本日' : rangeLabel(period.current, period.current.to);
  const reportHref = `/app/reports?from=${period.current.from}&to=${period.current.to}`;
  const cmpOf = (pick: (k: PeriodKpi) => number, fmt: (v: number) => string): CompareLine[] =>
    compareKpis.map((c) => ({
      label: COMPARE_LABEL[c.key],
      title: rangeLabel(c.range, period.current.to),
      d: delta(pick(cur), pick(c.kpi)),
      prevText: fmt(pick(c.kpi)),
    }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* 「ホーム」は上のバーに出ているので見出しは出さない（2026-10-24 Ronnie） */}
        <p className="text-[13px] text-ink-2">
          {asOf} 時点・{scopeLabel}
        </p>
        <Link
          href={reportHref}
          className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-bold text-royal hover:border-wisteria"
        >
          この期間のレポートを見る
        </Link>
      </div>

      {/* 1 枚のカード：期間と比較 → 数字 4 つ → 予算・回転率・リピート（・いまの席）。シンプルに（2026-10-24 Ronnie「funfo くらい簡単に。でも同じにはしない」） */}
      <section aria-label={`${periodTitle}の数字`} className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="px-5 pt-4 pb-3">
          <HomePeriodBar range={period.range} compare={period.compare} current={period.current} previous={period.previous} card={period.card} embedded />
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line bg-lilac-soft px-5 py-2 text-[12.5px]">
          <span className="font-bold text-ink">{isToday ? `本日（${rangeLabel(period.current, period.current.to)}）` : rangeLabel(period.current, period.current.to)}</span>
          <span className="text-ink-3">
            <span className="font-bold text-success">▲ 増えた</span>・<span className="font-bold text-danger">▼ 減った</span>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="売上（税込）"
            icon={<JapaneseYen className="h-4 w-4" />}
            bg={TONE.sales}
            blue
            value={yen(cur.sales)}
            cmp={cmpOf((k) => k.sales, yen)}
            rows={[
              ['会計済', yen(cur.settled)],
              ['未会計', cur.open > 0 || isToday ? yen(cur.open) : '—'],
            ]}
            href={isToday ? '/app/orders' : reportHref}
          />
          <Kpi
            label="客単価（税込）"
            icon={<Receipt className="h-4 w-4" />}
            bg={TONE.groups}
            blue
            value={yen(cur.avgSpend)}
            cmp={cmpOf((k) => k.avgSpend, yen)}
            rows={[['売上 ÷ 客数', '会計済み']]}
            href={reportHref}
          />
          <Kpi
            label="客数"
            icon={<User className="h-4 w-4" />}
            bg={TONE.guests}
            value={`${cur.guests.toLocaleString('ja-JP')}`}
            unit="人"
            cmp={cmpOf((k) => k.guests, (v) => `${v.toLocaleString('ja-JP')}人`)}
            rows={[['会計済み', `${cur.guests.toLocaleString('ja-JP')}人`]]}
            href={isToday ? '/app/orders' : reportHref}
          />
          <Kpi
            label="会計数"
            icon={<Users className="h-4 w-4" />}
            bg={TONE.groups}
            value={`${cur.groups.toLocaleString('ja-JP')}`}
            unit="件"
            cmp={cmpOf((k) => k.groups, (v) => `${v.toLocaleString('ja-JP')}件`)}
            rows={[['1 会計あたり', cur.groups > 0 ? yen(Math.floor(cur.settled / cur.groups)) : '—']]}
            href={isToday ? '/app/orders' : reportHref}
          />
        </div>

        <div className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
          <Mini label="予算の達成" icon={<Target className="h-3.5 w-3.5" />} bg={TONE.sales}>
            {cur.achievementPct != null && cur.budget ? (
              <>
                <span className="text-[20px] leading-tight font-extrabold text-ink tabular-nums">
                  {cur.achievementPct}
                  <span className="ml-0.5 text-[12px]">%</span>
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded-full bg-lilac">
                  <span
                    className={cn('block h-full rounded-full', cur.achievementPct >= 100 ? 'bg-success' : cur.achievementPct >= 90 ? 'bg-saffron' : 'bg-iris')}
                    style={{ width: `${Math.min(100, cur.achievementPct)}%` }}
                  />
                </span>
                <span className="text-xs text-ink-3">予算 {yen(cur.budget)}</span>
              </>
            ) : (
              <Link href="/app/budgets" className="text-[13px] font-bold text-royal hover:underline">
                予算未設定 — 登録する ›
              </Link>
            )}
          </Mini>
          <Mini label="客席回転率（1日平均）" icon={<RotateCw className="h-3.5 w-3.5" />} bg={TONE.walkIn}>
            <span className="text-[20px] leading-tight font-extrabold text-ink tabular-nums">
              {extras.turnover == null ? '—' : extras.turnover.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              <span className="ml-1 text-[12px]">回</span>
            </span>
            <span className="text-xs text-ink-3">{extras.seats > 0 ? `席数 ${extras.seats}席${extras.days > 1 ? `・${extras.days}日` : ''}` : '席数が未設定（設定 › テーブル）'}</span>
          </Mini>
          <Mini label="リピート率" title={repeatNote} icon={<Repeat className="h-3.5 w-3.5" />} bg={TONE.repeat}>
            <span className="text-[20px] leading-tight font-extrabold text-ink tabular-nums">
              {extras.repeat.ratePct == null ? '—' : extras.repeat.ratePct}
              <span className="ml-0.5 text-[12px]">%</span>
            </span>
            <span className="text-xs text-ink-3">
              {extras.repeat.ratePct == null ? '顧客を紐づけた会計なし' : `リピーター ${extras.repeat.repeaters}・新規 ${extras.repeat.newcomers}`}
            </span>
          </Mini>
          {rows ? (
            <Mini label="いまの店内" icon={<LayoutGrid className="h-3.5 w-3.5" />} bg={TONE.cash}>
              <span className="text-[20px] leading-tight font-extrabold text-ink tabular-nums">
                {rows.reduce((a, r) => a + r.tablesUsed, 0)}
                <span className="mx-0.5 text-[12px] font-bold text-ink-3">/</span>
                {rows.reduce((a, r) => a + r.tablesTotal, 0)}
                <span className="ml-1 text-[12px]">卓</span>
              </span>
              <span className="text-xs text-ink-3">
                未会計 {rows.reduce((a, r) => a + r.openCount, 0)}組 {yen(rows.reduce((a, r) => a + r.openTotal, 0))}・本日の予約 {rows.reduce((a, r) => a + r.resvGroups, 0)}組
              </span>
            </Mini>
          ) : (
            <Mini label="期間" icon={<CalendarDays className="h-3.5 w-3.5" />} bg={TONE.gray}>
              <span className="text-[20px] leading-tight font-extrabold text-ink tabular-nums">
                {extras.days}
                <span className="ml-1 text-[12px]">日間</span>
              </span>
              <span className="text-xs text-ink-3">1 日平均 {yen(extras.days > 0 ? Math.floor(cur.sales / extras.days) : 0)}</span>
            </Mini>
          )}
        </div>
      </section>

      {rows && rows.length > 1 && (
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
      )}

      {periodRows && periodRows.length > 1 && (
        <section aria-label="店舗" className="rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
            <h2 className="text-base font-extrabold text-ink">
              店舗<span className="ml-2 text-[12.5px] font-normal text-ink-3">{rangeLabel(period.current, period.current.to)}</span>
            </h2>
            <span className="text-[12.5px] text-ink-3">店舗を押すと、その期間のレポートが開きます</span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[780px] flex-col">
              <div className={cn(PERIOD_ROW_GRID, 'border-y border-line bg-lilac-soft px-5 py-2 text-xs text-ink-3')}>
                <span>店舗</span>
                <span className="text-right">売上（税込）</span>
                <span className="text-right">客数</span>
                <span className="text-right">会計</span>
                <span className="text-right">客単価</span>
                <span>予算の達成</span>
                <span />
              </div>
              {periodRows.map((r) => (
                <StoreSwitchLink
                  key={r.id}
                  storeId={r.id}
                  href={`${reportHref}&store=${r.id}`}
                  className={cn(PERIOD_ROW_GRID, 'w-full border-b border-line/70 px-5 py-3.5 text-left text-[13.5px] text-ink last:border-b-0 hover:bg-lilac-soft disabled:opacity-60')}
                >
                  <b className="truncate">{r.name}</b>
                  <span className="text-right font-extrabold tabular-nums">{yen(r.sales)}</span>
                  <span className="text-right tabular-nums">{r.guests}人</span>
                  <span className="text-right tabular-nums">{r.groups}件</span>
                  <span className="text-right tabular-nums">{yen(r.avgSpend)}</span>
                  <span className="flex flex-col gap-1">
                    {r.budgetPct != null ? (
                      <>
                        <span className={cn('font-bold tabular-nums', r.budgetPct < 70 && 'text-danger')}>
                          {r.budgetPct}%<span className="ml-1 text-xs font-normal text-ink-3">/ {yen(r.budget)}</span>
                        </span>
                        <span className="h-1 overflow-hidden rounded-full bg-lilac">
                          <span className={cn('block h-full', r.budgetPct >= 100 ? 'bg-success' : 'bg-iris')} style={{ width: `${Math.min(100, r.budgetPct)}%` }} />
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
                </StoreSwitchLink>
              ))}
            </div>
          </div>
        </section>
      )}

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
        <section aria-label="売上の中身" className="flex min-w-0 flex-[2_1_520px] flex-col gap-3 rounded-xl border border-line bg-white px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="売上の中身">
              {HOME_CARDS.map((c) => (
                <Link
                  key={c.key}
                  href={homeHref({ range: period.range, compare: period.compare, custom: period.range === 'custom' ? period.current : undefined, card: c.key })}
                  role="tab"
                  aria-selected={c.key === period.card}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold',
                    c.key === period.card ? 'bg-ink text-white' : 'text-ink-2 hover:bg-lilac-soft hover:text-royal'
                  )}
                >
                  {c.label}
                </Link>
              ))}
            </div>
            {period.card === 'hourly' && (
              <div className="flex gap-3.5 text-xs text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-[11px] w-[11px] rounded-[3px] bg-iris" aria-hidden />
                  {isToday ? '本日' : rangeLabel(period.current, period.current.to)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <i className="inline-block w-4 border-t-[2.5px] border-dashed border-[#d4891c]" aria-hidden />
                  {COMPARE_LABEL[period.compare]}（{rangeLabel(period.previous, period.current.to)}）
                </span>
              </div>
            )}
            {period.card !== 'hourly' && <span className="text-xs text-ink-3">{periodTitle}・会計済み</span>}
          </div>
          {period.card === 'hourly' && <HourlyCompareChart data={hourly} nowHour={nowHour ?? -1} />}
          {period.card === 'pay' && <PaymentShares items={extras.payments ?? []} />}
          {period.card === 'best' && <BestSellers items={extras.best ?? []} truncated={extras.bestTruncated} />}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  icon,
  bg,
  blue = false,
  value,
  unit,
  cmp,
  rows,
  href,
}: {
  label: string;
  /** 左の小さいアイコン（iPad のホームと同じ色の丸） */
  icon: React.ReactNode;
  bg: string;
  /** 数字を青に（iPad の 本日の売上・客単価 と同じ） */
  blue?: boolean;
  value: string;
  unit?: string;
  /** 数字の下の比較（前日比・前週同曜日比…を全部） */
  cmp: CompareLine[];
  /** 下の 1〜2 行（名前・値） */
  rows: [string, string][];
  href: string;
}) {
  return (
    <Link href={href} className="flex flex-col gap-1 bg-white px-5 py-4 hover:bg-lilac-soft">
      <span className="flex items-center gap-2 text-[12.5px] font-bold text-ink-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-white" style={{ backgroundImage: bg }}>
          {icon}
        </span>
        {label}
      </span>
      <span className={cn('text-[26px] leading-tight font-extrabold tabular-nums', blue ? 'text-royal' : 'text-ink')}>
        {value}
        {unit && <span className="ml-0.5 text-[13px]">{unit}</span>}
      </span>
      <span className="flex flex-col gap-0.5 text-xs">
        {cmp.map((c) => (
          <span key={c.label} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-2" title={c.title}>
            <span className="text-ink-2">{c.label}</span>
            <DeltaMark d={c.d} />
            <span className="text-right text-ink-3 tabular-nums">{c.prevText}</span>
          </span>
        ))}
      </span>
      <span className="mt-1 flex flex-col gap-0.5 text-xs text-ink-3">
        {rows.map(([k, v]) => (
          <span key={k} className="flex justify-between gap-2">
            <span>{k}</span>
            <span className="tabular-nums text-ink-2">{v}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}

/** 下の段の小さい数字（予算の達成・回転率・リピート率・いまの店内） */
function Mini({ label, title, icon, bg, children }: { label: string; title?: string; icon: React.ReactNode; bg: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-white px-5 py-3" title={title}>
      <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] text-white" style={{ backgroundImage: bg }}>
          {icon}
        </span>
        {label}
      </span>
      {children}
    </div>
  );
}

/** ▲6.4% / ▼2.1% / ±0%（前が 0 のときは「—」） */
function DeltaMark({ d }: { d: ReturnType<typeof delta> }) {
  if (d.pct == null) return <span className="font-bold text-ink-3">—</span>;
  const tone = d.direction === 'up' ? 'text-success' : d.direction === 'down' ? 'text-danger' : 'text-ink-3';
  const mark = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '±';
  return (
    <span className={cn('font-bold tabular-nums', tone)}>
      {mark}
      {Math.abs(d.pct).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%
    </span>
  );
}

/** 支払い方法の内訳（金額の多い順・横棒） */
function PaymentShares({ items }: { items: HomeExtras['payments'] & object }) {
  if (items.length === 0) return <p className="border-t border-line py-6 text-center text-sm text-ink-3">この期間の支払いはありません</p>;
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <ul className="flex flex-col gap-2.5 pt-1">
      {items.map((i) => (
        <li key={i.method} className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2.4fr)_90px_44px] items-center gap-3 text-[13px]">
          <span className="truncate text-ink">{i.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-lilac">
            <span className="block h-full rounded-full bg-iris" style={{ width: `${Math.max(2, Math.round((i.amount / max) * 100))}%` }} />
          </span>
          <span className="text-right font-bold text-ink tabular-nums">{yen(i.amount)}</span>
          <span className="text-right text-ink-3 tabular-nums">{i.pct}%</span>
        </li>
      ))}
    </ul>
  );
}

/** ベストセラー（数量の多い順 10 品） */
function BestSellers({ items, truncated }: { items: HomeExtras['best'] & object; truncated: boolean }) {
  if (items.length === 0) return <p className="border-t border-line py-6 text-center text-sm text-ink-3">この期間の会計済みの明細がありません</p>;
  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col">
        {items.map((i, idx) => (
          <li key={i.name} className="grid grid-cols-[28px_minmax(0,1fr)_72px_100px] items-center gap-3 border-t border-line/70 py-2 text-[13.5px] first:border-t-0">
            <span className={cn('text-center font-extrabold tabular-nums', idx < 3 ? 'text-iris' : 'text-ink-3')}>{idx + 1}</span>
            <span className="truncate text-ink">{i.name}</span>
            <span className="text-right font-bold text-ink tabular-nums">{i.quantity.toLocaleString('ja-JP')}個</span>
            <span className="text-right text-ink-2 tabular-nums">{yen(i.sales)}</span>
          </li>
        ))}
      </ol>
      {truncated && <span className="text-xs text-ink-3">明細が多いので、最初の 20,000 件で数えています</span>}
    </div>
  );
}
