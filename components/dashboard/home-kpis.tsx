/**
 * ホームのKPI行（5タイル・プロトタイプの .stats）。
 * 来店組数 / 客数 / 客単価 / 本日のリピーター率 / 在庫アラート
 */
import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';
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

const tileLink = 'block rounded-2xl transition-shadow hover:shadow-card focus-visible:outline-2 focus-visible:outline-primary';

export function HomeKpis({
  groups,
  groupsYesterday,
  guests,
  guestsYesterday,
  avgSpend,
  repeat,
  lowStock,
  guestsNote,
  ordersHref,
}: {
  groups: number;
  groupsYesterday: number;
  guests: number;
  guestsYesterday: number;
  avgSpend: number;
  repeat: RepeatSummary;
  lowStock: { count: number; names: string[] };
  /** 客数の補足（店内飲食のみ集計の設定時など） */
  guestsNote?: string;
  ordersHref: string;
}) {
  return (
    <section aria-label="本日の状況" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_1.2fr_1fr]">
      <Link href={ordersHref} className={tileLink}>
        <StatCard
          className="h-full"
          label="来店組数"
          en="Groups"
          value={groups.toLocaleString('ja-JP')}
          unit="組"
          sub={<DeltaNote today={groups} yesterday={groupsYesterday} unit="組" />}
        />
      </Link>
      <Link href={ordersHref} className={tileLink}>
        <StatCard
          className="h-full"
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
      </Link>
      <Link href="/app/reports" className={tileLink}>
        <StatCard
          className="h-full"
          label="客単価"
          en="Avg. spend"
          value={`¥${avgSpend.toLocaleString('ja-JP')}`}
          sub="実績売上高 ÷ 客数"
        />
      </Link>
      <Link href="/app/customers?sort=last_visit_desc" className={tileLink}>
        <StatCard
          className="h-full"
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
      </Link>
      <Link href="/app/inventory?sort=warning" className={cn(tileLink, 'col-span-2 md:col-span-1')}>
        <StatCard
          className="h-full"
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
      </Link>
    </section>
  );
}
