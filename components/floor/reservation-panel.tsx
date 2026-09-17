'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { PanelReservation } from './types';

const NOT_ARRIVED = ['pending', 'confirmed', 'waiting'];
const ARRIVED = ['arrived', 'seated', 'billing', 'completed'];
/** 開始時刻からこの時間を過ぎても来店がなければ「未連絡」 */
const LATE_MS = 15 * 60_000;

function chip(r: PanelReservation, now: number): { label: string; className: string } {
  if (NOT_ARRIVED.includes(r.status)) {
    return now > r.startMs + LATE_MS
      ? { label: '未連絡', className: 'bg-danger-soft text-danger' }
      : { label: '来店待ち', className: 'bg-lilac text-ink-2' };
  }
  switch (r.status) {
    case 'arrived':
      return { label: '来店', className: 'bg-success-soft text-success' };
    case 'seated':
      return { label: '来店済', className: 'bg-success-soft text-success' };
    case 'billing':
      return { label: '会計待ち', className: 'bg-saffron-soft text-saffron' };
    case 'completed':
      return { label: '会計済み', className: 'bg-success-soft text-success' };
    case 'no_show':
      return { label: '無断キャンセル', className: 'bg-gray-100 text-ink-3' };
    default:
      return { label: r.status, className: 'bg-gray-100 text-ink-3' };
  }
}

function Sum({ label, groups, people }: { label: string; groups: number; people?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-lilac-soft px-2.5 py-1.5">
      <span className="text-[10.5px] font-medium whitespace-nowrap text-ink-3">{label}</span>
      <span className="text-[17px] leading-tight font-extrabold whitespace-nowrap text-royal tabular-nums">
        {groups}
        <small className="ml-px text-[11px] font-medium text-ink-3">組</small>
        {people != null && (
          <em className="ml-1.5 text-ink not-italic">
            {people}
            <small className="ml-px text-[11px] font-medium text-ink-3">名</small>
          </em>
        )}
      </span>
    </div>
  );
}

export function ReservationPanel({
  reservations,
  now,
}: {
  reservations: PanelReservation[];
  now: number;
}) {
  const sameDay = reservations.filter((r) => r.createdToday);
  const arrived = reservations.filter((r) => ARRIVED.includes(r.status));
  const waiting = reservations.filter((r) => NOT_ARRIVED.includes(r.status));
  const people = (rs: PanelReservation[]) => rs.reduce((s, r) => s + r.partySize, 0);

  return (
    <section className="ui-card flex min-h-0 flex-col overflow-hidden border border-line bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-150px)]">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3.5 pt-3 pb-2.5">
        <h2 className="text-[14.5px] font-bold text-ink">
          本日のご予約<span className="en-inline">Today&apos;s reservations</span>
        </h2>
        <Link
          href="/app/reservations"
          className="inline-flex items-center rounded-lg bg-iris px-2.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-iris-deep"
        >
          店舗台帳<span className="ml-1 text-[10.5px] font-semibold text-white/85 tabular-nums">Open</span>
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-1.5 px-3">
        <Sum label="本日のご予約" groups={reservations.length} people={people(reservations)} />
        <Sum label="当日ご予約" groups={sameDay.length} people={people(sameDay)} />
        <Sum label="来店済" groups={arrived.length} />
        <Sum label="未来店" groups={waiting.length} />
      </div>

      {reservations.length === 0 ? (
        <p className="flex-1 px-4 py-10 text-center text-[13px] text-ink-3">本日のご予約はありません</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto px-1.5 pt-1">
          {reservations.map((r) => {
            const c = chip(r, now);
            return (
              <li
                key={r.id}
                className="flex min-w-0 items-center gap-2 border-b border-line px-1.5 py-[7px] last:border-b-0"
              >
                <time className="w-[42px] flex-none text-[13.5px] leading-none font-bold text-royal tabular-nums">
                  {r.time}
                </time>
                <span className="flex min-w-0 flex-1 flex-col leading-snug">
                  <b className="truncate text-[13px] font-medium text-ink">{r.name.replace(/ ?様$/, '')} 様</b>
                  <span className="truncate text-[11.5px] text-ink-3">
                    <span className="tabular-nums">{r.partySize}</span>名 ・ {r.tableLabel}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex-none rounded-full px-[7px] py-px text-[10.5px] font-bold whitespace-nowrap',
                    c.className
                  )}
                >
                  {c.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3.5 pt-2 pb-3 text-[12.5px] text-ink-3">
        <span className="truncate">
          残り <span className="tabular-nums">{waiting.length}</span>組
          {waiting.length > 0 && (
            <span className="tabular-nums">
              （{waiting[0].time}〜{waiting[waiting.length - 1].time}）
            </span>
          )}
        </span>
        <Link href="/app/reservations" className="flex-none text-[13px] font-bold text-iris hover:underline">
          すべて表示 ›
        </Link>
      </footer>
    </section>
  );
}
