'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getReservationCalendar, type ReservationCalendarData } from '@/app/app/reservations/actions';
import { holidayName } from '@/lib/jp-holidays';

/**
 * 日付選択（2026-10-19 Ronnie「日付を押したら、レストランボードのような日付選択。ハンディ・レジ・PC 全部」）。
 * 月ごとのカレンダーに、その日の予約の人数（〇名）・休業日（グレー）・仮予約／要連絡（赤い点）・祝日（赤）・土曜（青）。
 * 開いた日の月から3か月分。上の「前の月」・下の「次の月」で前後の月も出せる（2026-10-19 Ronnie「次の月も」）。押した日へ移る。
 */
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function monthStart(date: string): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}
function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function ReservationCalendarSheet({
  date,
  today,
  storeId = null,
  onSelect,
  onClose,
  months = 3,
}: {
  date: string;
  today: string;
  storeId?: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
  months?: number;
}) {
  const base = monthStart(date);
  // 前の月・次の月を足していく（最大 前12か月・全部で24か月）
  const [before, setBefore] = useState(0);
  const [count, setCount] = useState(months);
  const start = { y: base.y + Math.floor((base.m - 1 - before) / 12), m: ((((base.m - 1 - before) % 12) + 12) % 12) + 1 };
  const from = iso(start.y, start.m, 1);
  const to = iso(start.y, start.m + count, 0);
  const [data, setData] = useState<ReservationCalendarData | null>(null);

  useEffect(() => {
    let alive = true;
    getReservationCalendar(storeId, from, to)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ days: {}, closedDates: [], closedWeekdays: [] }));
    return () => {
      alive = false;
    };
  }, [storeId, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const closed = useMemo(() => new Set(data?.closedDates ?? []), [data]);
  const closedWd = useMemo(() => new Set(data?.closedWeekdays ?? []), [data]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col bg-[#fbf9f5]" role="dialog" aria-modal="true" aria-label="日付選択">
      <header className="relative flex h-14 shrink-0 items-center justify-center bg-[#292725] text-white">
        <button type="button" onClick={onClose} aria-label="閉じる" className="absolute left-2 flex h-11 w-11 items-center justify-center">
          <X className="h-6 w-6" aria-hidden />
        </button>
        <h2 className="text-[16px] font-bold">日付選択</h2>
      </header>
      <div className="flex shrink-0 items-center justify-end gap-4 px-4 py-2 text-[11.5px] text-[#5c5650]">
        <span className="flex items-center gap-1.5">
          <span className="h-4 w-5 rounded-[4px] bg-[#e9e4dc]" aria-hidden />
          休業日
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d9573f]" aria-hidden />
          仮予約／要連絡
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-[560px] space-y-6">
          {before < 12 && (
            <button
              type="button"
              onClick={() => {
                setBefore((b) => b + 1);
                setCount((c) => c + 1);
              }}
              className="mx-auto mt-2 flex h-10 items-center gap-1 rounded-full border border-[#e5dfd5] bg-white px-4 text-[13px] font-bold text-[#5c5650] active:bg-[#f6ebe3]"
            >
              <ChevronUp className="h-4 w-4" aria-hidden />
              前の月を見る
            </button>
          )}
          {Array.from({ length: count }, (_, i) => {
            const y = start.y + Math.floor((start.m - 1 + i) / 12);
            const m = ((start.m - 1 + i) % 12) + 1;
            const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
            const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
            const cells: (number | null)[] = [...Array(firstWd).fill(null), ...Array.from({ length: daysInMonth }, (_, k) => k + 1)];
            while (cells.length % 7 !== 0) cells.push(null);
            return (
              <section key={`${y}-${m}`}>
                <h3 className="mb-2 text-[18px] font-bold text-[#45403b]">
                  {y}年{m}月
                </h3>
                <div className="grid grid-cols-7 border-b border-[#ddd5ca] bg-[#efebe5] py-1.5 text-center text-[12.5px] font-bold">
                  {WEEK.map((w, wi) => (
                    <span key={w} className={wi === 0 ? 'text-[#c62828]' : wi === 6 ? 'text-[#2f5fb3]' : 'text-[#5c5650]'}>
                      {w}
                    </span>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-y-1">
                  {cells.map((d, ci) => {
                    if (d == null) return <span key={ci} />;
                    const key = iso(y, m, d);
                    const wd = ci % 7;
                    const hol = holidayName(key);
                    const info = data?.days[key];
                    const isClosed = closed.has(key) || closedWd.has(wd);
                    const selected = key === date;
                    return (
                      <button
                        key={ci}
                        type="button"
                        onClick={() => onSelect(key)}
                        title={hol ?? undefined}
                        className={cn(
                          'relative mx-auto flex h-[54px] w-full max-w-[64px] flex-col items-center justify-center rounded-[8px] leading-tight',
                          selected ? 'bg-[#bc5940] text-white' : isClosed ? 'bg-[#e9e4dc]' : 'active:bg-[#f3e6dd]',
                          key === today && !selected && 'ring-2 ring-[#bc5940]/60'
                        )}
                      >
                        <span
                          className={cn(
                            'text-[19px] font-bold tabular-nums',
                            selected ? 'text-white' : wd === 0 || hol ? 'text-[#c62828]' : wd === 6 ? 'text-[#2f5fb3]' : 'text-[#292725]'
                          )}
                        >
                          {d}
                        </span>
                        <span className={cn('h-[13px] text-[10.5px] tabular-nums', selected ? 'text-white/90' : 'text-[#766b62]')}>
                          {info && info.guests > 0 ? `${info.guests}名` : ''}
                        </span>
                        {info?.attention && <span className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-[#d9573f]" aria-label="仮予約・要連絡あり" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {count < 24 && (
            <button
              type="button"
              onClick={() => setCount((c) => c + 1)}
              className="mx-auto flex h-11 items-center gap-1 rounded-full border border-[#bc5940] bg-white px-5 text-[14px] font-bold text-[#bc5940] active:bg-[#f6ebe3]"
            >
              次の月を見る
              <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          )}
          {!data && <p className="text-center text-[12px] text-[#766b62]">予約の人数を読み込んでいます…</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
