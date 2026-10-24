import Link from 'next/link';
import { cn } from '@/lib/utils';
import { HOME_COMPARES, HOME_RANGES, rangeLabel, type DateRange, type HomeCompare, type HomeRange } from '@/lib/home-period';

function href(range: HomeRange, compare: HomeCompare, custom?: DateRange): string {
  const q = new URLSearchParams();
  if (range !== 'today') q.set('range', range);
  if (compare !== 'week') q.set('compare', compare);
  if (range === 'custom' && custom) {
    q.set('from', custom.from);
    q.set('to', custom.to);
  }
  const s = q.toString();
  return s ? `/app/dashboard?${s}` : '/app/dashboard';
}

const tab = 'inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-bold transition-colors';
const tabOff = 'border border-line bg-white text-ink-2 hover:border-wisteria hover:text-royal';
const tabOn = 'border border-ink bg-ink text-white';
const pill = 'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-bold';
const pillOff = 'text-ink-2 hover:bg-lilac-soft hover:text-royal';
const pillOn = 'bg-iris-soft text-royal';

/**
 * ホームの期間タブ（本日/昨日/過去7日間/今月/期間指定）と比較の選び方（前日比/前週同曜日比/前月同日比）。
 * 全部リンク（URL の ?range=&compare=&from=&to=）なので、サーバーで描き直すだけ。期間指定は日付 2 つのフォーム。
 */
export function HomePeriodBar({
  range,
  compare,
  current,
  previous,
}: {
  range: HomeRange;
  compare: HomeCompare;
  current: DateRange;
  previous: DateRange;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {HOME_RANGES.map((r) => (
          <Link
            key={r.key}
            href={href(r.key, compare, r.key === 'custom' ? current : undefined)}
            aria-current={r.key === range ? 'page' : undefined}
            className={cn(tab, r.key === range ? tabOn : tabOff)}
          >
            {r.label}
          </Link>
        ))}
        <span className="ml-auto text-[13px] text-ink-2">
          <b className="text-ink">{rangeLabel(current)}</b>
          <span className="mx-1.5 text-ink-3">vs</span>
          {rangeLabel(previous)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <span className="text-xs text-ink-3">比較</span>
        <div className="flex flex-wrap items-center gap-1">
          {HOME_COMPARES.map((c) => (
            <Link
              key={c.key}
              href={href(range, c.key, range === 'custom' ? current : undefined)}
              aria-current={c.key === compare ? 'page' : undefined}
              className={cn(pill, c.key === compare ? pillOn : pillOff)}
            >
              {c.label}
            </Link>
          ))}
        </div>
        {range === 'custom' && (
          <form action="/app/dashboard" method="get" className="ml-auto flex flex-wrap items-center gap-2 text-[13px]">
            <input type="hidden" name="range" value="custom" />
            <input type="hidden" name="compare" value={compare} />
            <label className="flex items-center gap-1.5">
              <span className="text-ink-3">開始</span>
              <input type="date" name="from" defaultValue={current.from} required className="h-8 rounded-md border border-line px-2 text-ink" />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-ink-3">終了</span>
              <input type="date" name="to" defaultValue={current.to} required className="h-8 rounded-md border border-line px-2 text-ink" />
            </label>
            <button type="submit" className="h-8 rounded-md bg-royal px-3 text-[12.5px] font-bold text-white hover:opacity-90">
              表示
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
