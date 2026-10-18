/**
 * ホームのKPI行。来店組数 / 客数 / 本日のリピーター率 / 在庫アラート
 * 2026-10-18 Ronnie「箱をバラバラに作るときれいに見えない。ひとつにして」→ 1つの白い箱を線で区切る。
 * 客単価は別の箱にしないで、予算達成率の「実績売上高」の下に小さく出す（budget-card.tsx）。
 */
import Link from 'next/link';
import { formatDayDelta, type RepeatSummary } from '@/lib/home-todos';
import { cn } from '@/lib/utils';

function DeltaNote({ today, yesterday, unit }: { today: number; yesterday: number; unit: string }) {
  const d = today - yesterday;
  return (
    <span className={cn('font-bold tabular-nums', d > 0 ? 'text-success' : d < 0 ? 'text-danger' : 'text-ink-3')}>
      前日比 {formatDayDelta(today, yesterday, unit)}
    </span>
  );
}

function KpiCell({
  href,
  label,
  en,
  value,
  unit,
  sub,
  className,
}: {
  href: string;
  label: string;
  en: string;
  value: React.ReactNode;
  unit?: string;
  sub: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-w-0 flex-col gap-1 bg-white px-4 py-3.5 transition-colors hover:bg-lilac-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        className
      )}
    >
      <span className="text-xs font-medium text-ink-2">
        {label}
        <span className="en-under">{en}</span>
      </span>
      <span className="text-2xl leading-tight font-bold text-navy tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-ink-3">{unit}</span>}
      </span>
      <span className="text-xs text-ink-3">{sub}</span>
    </Link>
  );
}

export function HomeKpis({
  groups,
  groupsYesterday,
  guests,
  guestsYesterday,
  repeat,
  lowStock,
  guestsNote,
  ordersHref,
}: {
  groups: number;
  groupsYesterday: number;
  guests: number;
  guestsYesterday: number;
  repeat: RepeatSummary;
  lowStock: { count: number; names: string[] };
  /** 客数の補足（店内飲食のみ集計の設定時など） */
  guestsNote?: string;
  ordersHref: string;
}) {
  return (
    // 1つの箱。中の区切り線は gap-px の下地（bg-line）で描く（4つなので 2×2 か 4つ横並び）
    <section
      aria-label="本日の状況"
      className="ui-card grid grid-cols-2 gap-px overflow-hidden border border-line bg-line lg:grid-cols-4"
    >
      <KpiCell
        href={ordersHref}
        label="来店組数"
        en="Groups"
        value={groups.toLocaleString('ja-JP')}
        unit="組"
        sub={<DeltaNote today={groups} yesterday={groupsYesterday} unit="組" />}
      />
      <KpiCell
        href={ordersHref}
        label="客数"
        en="Guests"
        value={guests.toLocaleString('ja-JP')}
        unit="名"
        sub={
          <>
            <DeltaNote today={guests} yesterday={guestsYesterday} unit="名" />
            {guestsNote && <span className="ml-1">（{guestsNote}）</span>}
          </>
        }
      />
      <KpiCell
        href="/app/customers?sort=last_visit_desc"
        label="本日のリピーター率"
        en="Repeat rate"
        value={repeat.ratePct ?? '—'}
        unit="%"
        sub={
          repeat.ratePct == null ? (
            '顧客紐付けの会計なし'
          ) : (
            <span className="tabular-nums">
              リピーター {repeat.repeaters}名 ／ 新規 {repeat.newcomers}名
            </span>
          )
        }
      />
      <KpiCell
        href="/app/inventory?sort=warning"
        label="在庫アラート"
        en="Stock alerts"
        value={lowStock.count}
        unit="品"
        sub={
          lowStock.count === 0 ? (
            '下限を下回る品目はありません'
          ) : (
            <span className="line-clamp-2">
              {lowStock.names.join('・')}
              {lowStock.count > lowStock.names.length && ` 他${lowStock.count - lowStock.names.length}品`}
            </span>
          )
        }
      />
    </section>
  );
}
