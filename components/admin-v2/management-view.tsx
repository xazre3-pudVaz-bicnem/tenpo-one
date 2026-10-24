import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { calendarWeeks, shiftMonthKey, type DayCell, type ManagementSummary, type StoreSummary } from '@/lib/management-dashboard';
import { StoreSwitchLink } from './store-switch-link';

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

function monthHref(month: string, store: string | null): string {
  const q = new URLSearchParams({ month });
  if (store) q.set('store', store);
  return `/app/management?${q.toString()}`;
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function pctText(v: number | null, digits = 1): string {
  return v == null ? '—' : `${v.toLocaleString('ja-JP', { maximumFractionDigits: digits })}%`;
}

/** 率の色：目標があれば「目標以下＝緑・超えたら赤」、無ければ黒 */
function rateTone(v: number | null, target: number | null, lowerIsBetter = true): string {
  if (v == null || target == null) return 'text-ink';
  const good = lowerIsBetter ? v <= target : v >= target;
  return good ? 'text-success' : 'text-danger';
}

/** カレンダー用の金額：1 万円未満はそのまま（¥1,000）、1 万円以上は万円（¥12.3万・¥120万） */
function man(v: number): string {
  if (Math.abs(v) < 10_000) return yen(v);
  const m = v / 10_000;
  return `¥${m.toLocaleString('ja-JP', { maximumFractionDigits: Math.abs(m) >= 100 ? 0 : 1 })}万`;
}

/**
 * 経営ダッシュボード（2026-10-24 Ronnie「dinii の経営管理のような画面を TENPO ONE にも」）。
 * 月を選んで：売上と予算の達成 ／ 原価率・人件費率・営業利益（目標つき）／ 店舗別一覧 ／ 営業カレンダー。
 * 数字はレポートと同じ定義（lib/management-dashboard.ts の先頭に書いてある）。
 */
export function ManagementView({
  summary,
  scopeLabel,
  today,
  storeOverrideId,
  costNote,
}: {
  summary: ManagementSummary;
  scopeLabel: string;
  today: string;
  storeOverrideId: string | null;
  costNote: { excludedCount: number; missingRuleCount: number };
}) {
  const t = summary.total;
  const tg = summary.targets;
  const isThisMonth = summary.month === today.slice(0, 7);
  const weeks = calendarWeeks(summary.days);
  const reportHref = `/app/reports?from=${summary.month}-01&to=${summary.days[summary.days.length - 1]?.date ?? `${summary.month}-01`}${storeOverrideId ? `&store=${storeOverrideId}` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-black text-ink">経営ダッシュボード</h1>
          <p className="text-[13px] text-ink-2">
            {scopeLabel}・金額は税込（純売上）・{isThisMonth ? `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} までの実績` : '月の実績'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="月" className="inline-flex h-10 items-center rounded-lg border border-line bg-white">
            <Link href={monthHref(shiftMonthKey(summary.month, -1), storeOverrideId)} aria-label="前の月" className="flex h-full w-10 items-center justify-center text-ink-2 hover:text-royal">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-[120px] px-2 text-center text-sm font-extrabold text-ink tabular-nums">{monthLabel(summary.month)}</span>
            <Link href={monthHref(shiftMonthKey(summary.month, 1), storeOverrideId)} aria-label="次の月" className="flex h-full w-10 items-center justify-center text-ink-2 hover:text-royal">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </nav>
          {!isThisMonth && (
            <Link href={monthHref(today.slice(0, 7), storeOverrideId)} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-sm font-bold text-royal hover:border-wisteria">
              今月
            </Link>
          )}
          <Link href={reportHref} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-bold text-royal hover:border-wisteria">
            レポートでくわしく
          </Link>
          <Link href="/app/budgets" className="inline-flex h-10 items-center rounded-lg bg-plum px-4 text-sm font-bold text-white hover:opacity-90">
            目標を設定
          </Link>
        </div>
      </div>

      {/* 売上と達成 */}
      <section aria-label="売上と予算" className="grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-white lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-3 px-6 py-5 lg:border-r lg:border-line">
          <span className="text-[12.5px] text-ink-2">売上（税込）</span>
          <span className="text-[36px] leading-none font-black text-ink tabular-nums">{yen(t.sales)}</span>
          <div className="mt-1 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[13px]">
            <Stat label="客数" value={`${t.guests.toLocaleString('ja-JP')}人`} />
            <Stat label="客単価" value={yen(t.avgSpend)} />
            <Stat label="会計" value={`${t.groups.toLocaleString('ja-JP')}件`} />
          </div>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          <Progress
            label={isThisMonth ? '今日までの達成率' : '月の達成率'}
            help={isThisMonth ? '売上 ÷ 今日までの予算の累計（日別予算 → 無ければ月予算÷日数）' : '売上 ÷ 月の予算'}
            pct={isThisMonth ? t.pacePct : t.achievementPct}
            text={isThisMonth ? `${yen(t.sales)} / ${t.paceBudget != null ? yen(t.paceBudget) : '予算未設定'}` : `${yen(t.sales)} / ${t.budget != null ? yen(t.budget) : '予算未設定'}`}
          />
          {isThisMonth && (
            <Progress
              label="月次目標に対する進捗"
              help="売上 ÷ 月の予算"
              pct={t.achievementPct}
              text={`${yen(t.sales)} / ${t.budget != null ? yen(t.budget) : '予算未設定'}`}
              muted
            />
          )}
          {t.budget == null && (
            <Link href="/app/budgets" className="text-xs font-bold text-royal hover:underline">
              予算（月の売上目標）を登録する ›
            </Link>
          )}
        </div>
      </section>

      {/* 原価率・人件費率・営業利益 */}
      <section aria-label="原価率・人件費率・営業利益" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RateCard
          label="原価率"
          value={t.costRatePct}
          target={tg.costRateTarget}
          tone={rateTone(t.costRatePct, tg.costRateTarget)}
          sub={`原価 ${yen(t.cost)}`}
          note={costNote.excludedCount > 0 ? `原価未設定の明細 ${costNote.excludedCount.toLocaleString('ja-JP')} 件は除く` : undefined}
        />
        <RateCard
          label="人件費率"
          value={t.laborRatePct}
          target={tg.laborRateTarget}
          tone={rateTone(t.laborRatePct, tg.laborRateTarget)}
          sub={`人件費 ${yen(t.labor)}（勤怠 × 給与ルールの概算）`}
          note={costNote.missingRuleCount > 0 ? `給与ルールの無い勤務 ${costNote.missingRuleCount} 件は除く` : undefined}
        />
        <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-white px-5 py-4">
          <span className="text-[12.5px] text-ink-2">営業利益（概算）</span>
          <span className={cn('text-[28px] leading-tight font-extrabold tabular-nums', t.profit < 0 ? 'text-danger' : 'text-ink')}>{yen(t.profit)}</span>
          <span className="text-[13px] text-ink-2">
            営業利益率 <b className={cn('tabular-nums', tg.profitTarget != null ? rateTone(t.profit, tg.profitTarget, false) : 'text-ink')}>{pctText(t.profitRatePct)}</b>
            {tg.profitTarget != null && <span className="ml-2 text-xs text-ink-3">目標 {yen(tg.profitTarget)}</span>}
          </span>
          <span className="text-xs text-ink-3">
            売上 − 原価 − 人件費 − 経費 {yen(t.expenses)} − 固定費の日割り {yen(t.fixed)}
          </span>
        </div>
      </section>

      {/* 店舗別一覧 */}
      {summary.stores.length > 1 && (
        <section aria-label="店舗別" className="rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
            <h2 className="text-base font-extrabold text-ink">店舗別</h2>
            <span className="text-[12.5px] text-ink-3">店舗を押すと、その店舗だけの経営ダッシュボード</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-[13.5px]">
              <thead>
                <tr className="border-y border-line bg-lilac-soft text-left text-xs text-ink-3">
                  <th className="px-5 py-2 font-normal">店舗</th>
                  <th className="px-3 py-2 text-right font-normal">売上（税込）</th>
                  <th className="px-3 py-2 text-right font-normal">{isThisMonth ? '今日までの達成率' : '達成率'}</th>
                  <th className="px-3 py-2 text-right font-normal">月の進捗</th>
                  <th className="px-3 py-2 text-right font-normal">客数</th>
                  <th className="px-3 py-2 text-right font-normal">客単価</th>
                  <th className="px-3 py-2 text-right font-normal">原価率</th>
                  <th className="px-3 py-2 text-right font-normal">人件費率</th>
                  <th className="px-3 py-2 text-right font-normal">営業利益</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...summary.stores]
                  .sort((a, b) => b.sales - a.sales)
                  .map((s) => (
                    <StoreRow key={s.id} s={s} month={summary.month} isThisMonth={isThisMonth} targets={tg} />
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 営業カレンダー */}
      <section aria-label="営業カレンダー" className="rounded-xl border border-line bg-white px-5 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-extrabold text-ink">
            営業カレンダー<span className="ml-2 text-[12.5px] font-normal text-ink-3">{monthLabel(summary.month)}・日ごとの売上と達成率</span>
          </h2>
          <span className="text-xs text-ink-3">未来の日は予算だけ。今日は枠つき</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-bold">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={cn(i === 5 ? 'text-iris' : i === 6 ? 'text-danger' : 'text-ink-3')}>
                  {w}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((cell, di) => (cell ? <DayBox key={cell.date} cell={cell} weekday={di} /> : <div key={`e${wi}-${di}`} className="min-h-[96px] rounded-lg bg-lilac-soft/60" />))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="font-bold text-ink tabular-nums">{value}</span>
    </span>
  );
}

function Progress({ label, help, pct, text, muted }: { label: string; help: string; pct: number | null; text: string; muted?: boolean }) {
  const tone = pct == null ? 'bg-lilac' : pct >= 100 ? 'bg-success' : pct >= 90 ? 'bg-saffron' : 'bg-iris';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ink-2" title={help}>
          {label}
        </span>
        <span className={cn('text-[22px] leading-none font-extrabold tabular-nums', muted ? 'text-ink-2' : 'text-ink')}>
          {pct == null ? '—' : pct}
          <span className="ml-0.5 text-[13px]">%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-lilac">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      <span className="text-xs text-ink-3 tabular-nums">{text}</span>
    </div>
  );
}

function RateCard({ label, value, target, tone, sub, note }: { label: string; value: number | null; target: number | null; tone: string; sub: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-white px-5 py-4">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className={cn('text-[28px] leading-tight font-extrabold tabular-nums', tone)}>{pctText(value)}</span>
      <span className="text-[13px] text-ink-2">
        目標 <b className="tabular-nums">{target != null ? `${target}%` : '未設定'}</b>
      </span>
      <span className="text-xs text-ink-3">{sub}</span>
      {note && <span className="text-xs text-ink-3">{note}</span>}
    </div>
  );
}

function StoreRow({ s, month, isThisMonth, targets }: { s: StoreSummary; month: string; isThisMonth: boolean; targets: ManagementSummary['targets'] }) {
  const cls = 'px-3 py-3 text-right tabular-nums';
  const pace = isThisMonth ? s.pacePct : s.achievementPct;
  return (
    <tr className="border-b border-line/70 last:border-b-0 hover:bg-lilac-soft">
      <td className="px-5 py-3 font-bold text-ink">
        <StoreSwitchLink storeId={s.id} href={monthHref(month, s.id)} className="hover:text-royal">
          {s.name}
        </StoreSwitchLink>
      </td>
      <td className={cn(cls, 'font-extrabold text-ink')}>{yen(s.sales)}</td>
      <td className={cn(cls, 'font-bold', pace == null ? 'text-ink-3' : pace >= 100 ? 'text-success' : pace < 70 ? 'text-danger' : 'text-ink')}>{pace == null ? '—' : `${pace}%`}</td>
      <td className={cn(cls, 'text-ink-2')}>{s.achievementPct == null ? '—' : `${s.achievementPct}%`}</td>
      <td className={cn(cls, 'text-ink-2')}>{s.guests.toLocaleString('ja-JP')}人</td>
      <td className={cn(cls, 'text-ink-2')}>{yen(s.avgSpend)}</td>
      <td className={cn(cls, rateTone(s.costRatePct, targets.costRateTarget))}>{pctText(s.costRatePct)}</td>
      <td className={cn(cls, rateTone(s.laborRatePct, targets.laborRateTarget))}>{pctText(s.laborRatePct)}</td>
      <td className={cn(cls, 'font-bold', s.profit < 0 ? 'text-danger' : 'text-ink')}>{yen(s.profit)}</td>
      <td className="px-2 py-3 text-ink-3">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </td>
    </tr>
  );
}

function DayBox({ cell, weekday }: { cell: DayCell; weekday: number }) {
  const dayNo = Number(cell.date.slice(8, 10));
  const dayTone = weekday === 5 ? 'text-iris' : weekday === 6 ? 'text-danger' : 'text-ink';
  const bg = weekday === 5 ? 'bg-iris-soft/40' : weekday === 6 ? 'bg-danger-soft/50' : 'bg-white';
  const row = 'flex items-baseline justify-between gap-1 leading-tight';
  return (
    <Link
      href={`/app/dashboard?range=custom&from=${cell.date}&to=${cell.date}`}
      className={cn(
        'flex min-h-[96px] flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] hover:border-wisteria',
        bg,
        cell.isToday ? 'border-2 border-iris' : 'border-line/70',
        cell.isFuture && 'opacity-80'
      )}
      title={cell.isFuture ? `${cell.date} の予算` : `${cell.date} の実績（押すとホームでこの日を見る）`}
    >
      <span className={cn('text-[12.5px] font-extrabold tabular-nums', dayTone)}>
        {dayNo}
        {cell.isToday && <span className="ml-1 rounded bg-iris px-1 text-[10px] font-bold text-white">今日</span>}
      </span>
      {cell.isFuture ? (
        <span className={cn(row, 'text-ink-3')}>
          <span>目標</span>
          <span className="tabular-nums">{cell.budget != null ? man(cell.budget) : '—'}</span>
        </span>
      ) : (
        <>
          <span className={cn(row, 'text-ink')}>
            <span className="text-ink-3">売上</span>
            <span className="font-bold tabular-nums">{man(cell.sales)}</span>
          </span>
          <span className={row}>
            <span className="text-ink-3">達成率</span>
            <span className={cn('font-bold tabular-nums', cell.achievementPct == null ? 'text-ink-3' : cell.achievementPct >= 100 ? 'text-success' : 'text-danger')}>
              {cell.achievementPct == null ? '—' : `${cell.achievementPct}%`}
            </span>
          </span>
          <span className={cn(row, 'text-ink-2')}>
            <span className="text-ink-3">客数</span>
            <span className="tabular-nums">{cell.guests}人</span>
          </span>
          <span className={cn(row, 'text-ink-2')}>
            <span className="text-ink-3">客単価</span>
            <span className="tabular-nums">{yen(cell.avgSpend)}</span>
          </span>
          <span className={cn(row, 'text-ink-2')}>
            <span className="text-ink-3">原価率</span>
            <span className="tabular-nums">{pctText(cell.costRatePct, 0)}</span>
          </span>
          <span className={cn(row, 'text-ink-2')}>
            <span className="text-ink-3">人件費率</span>
            <span className="tabular-nums">{pctText(cell.laborRatePct, 0)}</span>
          </span>
        </>
      )}
    </Link>
  );
}
