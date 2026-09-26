import Link from 'next/link';
import { ChevronLeft, ChevronRight, Wine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { shiftDay, shiftMonth, type CloseBreakdown, type CountRow, type ItemRow } from '@/lib/close-breakdown';
import type { BreakdownPeriod } from '@/app/app/cash/close/breakdown-data';

/**
 * レジクローズの「売上の内訳」（2026-09-27 Ronnie「グルメサイトごと・ウォークイン、担当ごとの伝票数、
 * よく出たコース・メニュー、飲み放題で何杯出たか。日次と月次。レシートには出さない」）。
 * 画面だけ。日次／月次は URL（?period=day|month&date=）で切り替える（サーバーで集計）。
 */
export function CloseBreakdownCard({
  data,
  period,
  date,
  today,
  basePath,
}: {
  data: CloseBreakdown;
  period: BreakdownPeriod;
  /** day: 'YYYY-MM-DD'、month: 'YYYY-MM' */
  date: string;
  today: string;
  basePath: string;
}) {
  const month = today.slice(0, 7);
  const isDay = period === 'day';
  const prev = isDay ? shiftDay(date, -1) : shiftMonth(date, -1);
  const next = isDay ? shiftDay(date, 1) : shiftMonth(date, 1);
  const atLatest = isDay ? date >= today : date >= month;
  const label = isDay ? fmtDay(date) : fmtMonth(date);
  const href = (p: BreakdownPeriod, d: string) => `${basePath}?period=${p}&date=${d}`;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle en="Sales breakdown">売上の内訳</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="inline-flex rounded-xl border border-line bg-white p-1" aria-label="期間">
            <Link href={href('day', today)} className={cn('rounded-lg px-3 py-1.5 text-[13px] font-bold', isDay ? 'on-brand text-white' : 'text-ink-2 hover:bg-lilac-soft')}>
              日次<span className="ml-1 font-num text-[10.5px] font-semibold opacity-80">Daily</span>
            </Link>
            <Link href={href('month', month)} className={cn('rounded-lg px-3 py-1.5 text-[13px] font-bold', !isDay ? 'on-brand text-white' : 'text-ink-2 hover:bg-lilac-soft')}>
              月次<span className="ml-1 font-num text-[10.5px] font-semibold opacity-80">Monthly</span>
            </Link>
          </nav>
          <div className="inline-flex items-center rounded-xl border border-line bg-white">
            <Link href={href(period, prev)} aria-label="前へ" className="grid h-9 w-9 place-items-center rounded-l-xl text-ink-2 hover:bg-lilac-soft">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-[132px] px-2 text-center text-[13px] font-bold text-navy tabular-nums">{label}</span>
            {atLatest ? (
              <span className="grid h-9 w-9 place-items-center text-gray-300"><ChevronRight className="h-4 w-4" /></span>
            ) : (
              <Link href={href(period, next)} aria-label="次へ" className="grid h-9 w-9 place-items-center rounded-r-xl text-ink-2 hover:bg-lilac-soft">
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-[12px] text-ink-3">
          {label}：会計 <b className="tabular-nums text-ink">{data.totals.orders}</b>件 ／ 客数{' '}
          <b className="tabular-nums text-ink">{data.totals.guests}</b>名 ／ 売上 <b className="tabular-nums text-ink">{yen(data.totals.sales)}</b>
          <span className="ml-2">※画面だけの表示です（クローズのレシートには印字しません）</span>
        </p>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <CountTable title="予約経路別" en="By source" hint="グルメサイトごと・ウォークイン・テイクアウト" rows={data.bySource} />
          <CountTable title="担当者別" en="By clerk" hint="担当が付いた伝票の数・客数・品数・売上" rows={data.byClerk} showItems />
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-3">
          <ItemTable title="コース・プラン" en="Courses" rows={data.courses} unit="組" />
          <ItemTable title="フード" en="Food" rows={data.foods} unit="個" />
          <ItemTable title="ドリンク" en="Drinks" rows={data.drinks} unit="杯" />
        </div>

        {/* 飲み放題 */}
        <div className="rounded-2xl border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="flex items-center gap-2 text-[15px] font-bold text-navy">
              <Wine className="h-4 w-4 text-royal" aria-hidden />
              飲み放題<span className="en-inline text-xs">All-you-can-drink</span>
            </p>
            <p className="text-[13px] text-ink-2">
              伝票 <b className="tabular-nums text-ink">{data.nomihoudai.orders}</b>件 ／ プラン{' '}
              <b className="tabular-nums text-ink">{data.nomihoudai.planCount}</b>名分 ／ 出たドリンク{' '}
              <b className="text-[17px] tabular-nums text-ink">{data.nomihoudai.glasses}</b>杯
              {data.nomihoudai.planCount > 0 && (
                <span className="ml-1 text-ink-3">（1名あたり {(data.nomihoudai.glasses / data.nomihoudai.planCount).toFixed(1)}杯）</span>
              )}
            </p>
          </div>
          {data.nomihoudai.orders === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-3">この期間に飲み放題の伝票はありません</p>
          ) : (
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="border-b border-line lg:border-r lg:border-b-0">
                <p className="px-4 pt-3 text-[11px] font-bold text-ink-3">プラン別</p>
                <Rows rows={data.nomihoudai.plans} unit="名分" showSales={false} />
              </div>
              <div>
                <p className="px-4 pt-3 text-[11px] font-bold text-ink-3">飲み放題で出たドリンク（杯数）</p>
                <Rows rows={data.nomihoudai.drinks} unit="杯" showSales={false} columns={2} />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function fmtDay(d: string): string {
  const [y, m, dd] = d.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${y}/${m}/${dd}（${w}）`;
}
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

function CountTable({ title, en, hint, rows, showItems }: { title: string; en: string; hint: string; rows: CountRow[]; showItems?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="border-b border-line px-4 py-2.5">
        <p className="text-[15px] font-bold text-navy">
          {title}
          <span className="en-inline text-xs">{en}</span>
        </p>
        <p className="text-[11px] text-ink-3">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-3">この期間の会計はありません</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-lilac-soft text-[11px] text-ink-3">
              <th className="px-4 py-1.5 text-left font-bold">{showItems ? '担当' : '経路'}</th>
              <th className="px-2 py-1.5 text-right font-bold">伝票</th>
              <th className="px-2 py-1.5 text-right font-bold">客数</th>
              {showItems && <th className="px-2 py-1.5 text-right font-bold">品数</th>}
              <th className="px-4 py-1.5 text-right font-bold">売上</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2 text-ink">{r.label}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-2">{r.orders}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-2">{r.guests}</td>
                {showItems && <td className="px-2 py-2 text-right tabular-nums text-ink-2">{r.items ?? 0}</td>}
                <td className="px-4 py-2 text-right font-bold tabular-nums text-ink">{yen(r.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ItemTable({ title, en, rows, unit }: { title: string; en: string; rows: ItemRow[]; unit: string }) {
  const total = rows.reduce((a, r) => a + r.quantity, 0);
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-[15px] font-bold text-navy">
          {title}
          <span className="en-inline text-xs">{en}</span>
        </p>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {total}
          {unit}
        </span>
      </div>
      {rows.length === 0 ? <p className="px-4 py-4 text-sm text-ink-3">なし</p> : <Rows rows={rows} unit={unit} showSales />}
    </div>
  );
}

/** 上位 10 件を出し、残りは details で開く */
function Rows({ rows, unit, showSales, columns = 1 }: { rows: ItemRow[]; unit: string; showSales: boolean; columns?: 1 | 2 }) {
  const head = rows.slice(0, 10);
  const rest = rows.slice(10);
  const Row = ({ r, i }: { r: ItemRow; i: number }) => (
    <li className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[13px] last:border-b-0">
      <span className="w-5 shrink-0 text-[11px] tabular-nums text-ink-3">{i + 1}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
      <span className="shrink-0 font-bold tabular-nums text-ink">
        {r.quantity}
        <span className="ml-0.5 text-[11px] font-medium text-ink-3">{unit}</span>
      </span>
      {showSales && <span className="w-[78px] shrink-0 text-right text-[12px] tabular-nums text-ink-2">{yen(r.sales)}</span>}
    </li>
  );
  return (
    <div>
      <ul className={cn(columns === 2 && 'sm:grid sm:grid-cols-2 sm:[&>li:nth-child(odd)]:border-r')}>
        {head.map((r, i) => (
          <Row key={r.name} r={r} i={i} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer px-4 py-2 text-[12px] font-bold text-royal">残り {rest.length} 件を見る</summary>
          <ul className={cn(columns === 2 && 'sm:grid sm:grid-cols-2 sm:[&>li:nth-child(odd)]:border-r')}>
            {rest.map((r, i) => (
              <Row key={r.name} r={r} i={i + 10} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
