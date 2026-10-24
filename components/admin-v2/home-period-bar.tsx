import Link from 'next/link';
import { cn } from '@/lib/utils';
import { HOME_COMPARES, HOME_RANGES, defaultCompareFor, homeHref, rangeLabel, type DateRange, type HomeCard, type HomeCompare, type HomeRange } from '@/lib/home-period';

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
  card,
  embedded = false,
}: {
  range: HomeRange;
  compare: HomeCompare;
  current: DateRange;
  previous: DateRange;
  card: HomeCard;
  /** カードの中に置く（外枠なし・タブと比較を 1 行に） */
  embedded?: boolean;
}) {
  const href = (r: HomeRange, c: HomeCompare, custom?: DateRange) => homeHref({ range: r, compare: defaultCompareFor(r, c), custom, card });
  if (embedded) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
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
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-0.5 rounded-full bg-lilac p-0.5" role="radiogroup" aria-label="比較">
            {HOME_COMPARES.map((c) => (
              <Link
                key={c.key}
                href={href(range, c.key, range === 'custom' ? current : undefined)}
                role="radio"
                aria-checked={c.key === compare}
                className={cn('inline-flex h-7 items-center rounded-full px-3 text-[12px] font-bold', c.key === compare ? 'bg-white text-ink shadow-sm' : 'text-ink-2 hover:text-royal')}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
        {range === 'custom' && (
          <form action="/app/dashboard" method="get" className="flex flex-wrap items-center gap-2 text-[13px]">
            <input type="hidden" name="range" value="custom" />
            <input type="hidden" name="compare" value={compare} />
            {card !== 'hourly' && <input type="hidden" name="card" value={card} />}
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
    );
  }
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
          <b className="text-ink">{rangeLabel(current, current.to)}</b>
          <span className="mx-1.5 text-ink-3">vs</span>
          {rangeLabel(previous, current.to)}
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
            {card !== 'hourly' && <input type="hidden" name="card" value={card} />}
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
