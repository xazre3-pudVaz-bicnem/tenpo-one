'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  handyDayLabel,
  handyNewReservationHref,
  handyReservationsHref,
  isIsoDate,
  shiftDate,
} from '@/lib/handy-reservations';

/**
 * ハンディの予約の日付バー（2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」）。
 *   ‹ 前の日 ／ 10/16（木）（押すとカレンダー）／ 次の日 ›、今日でないときは「今日」、右に「＋ 予約を追加」
 */
export function HandyReservationDateBar({
  date,
  today,
  canAdd,
}: {
  date: string;
  today: string;
  /** 予約を追加できる（予約の登録の権限がある） */
  canAdd: boolean;
}) {
  const router = useRouter();
  const pickerRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
        return;
      }
    } catch {
      // showPicker が使えないブラウザはフォーカスで開く
    }
    el.focus();
    el.click();
  };

  const navBtn =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3]';

  return (
    <div className="space-y-2 px-3 pt-2.5">
      <div className="flex items-center gap-2">
        <Link href={handyReservationsHref(shiftDate(date, -1), today)} aria-label="前の日" className={navBtn}>
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={openPicker}
          className="relative flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-[#ead9cc] bg-[#f9ede6] px-2 text-[15px] font-bold text-[#45403b] active:bg-[#f6e4da]"
          aria-label="日付を選ぶ"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-[#bc5940]" aria-hidden />
          <span className="truncate tabular-nums">{handyDayLabel(date)}</span>
          {date === today && <span className="shrink-0 text-[10px] font-semibold text-[#bc5940]">今日</span>}
          <input
            ref={pickerRef}
            type="date"
            value={date}
            onChange={(e) => {
              const next = e.target.value;
              if (isIsoDate(next)) router.push(handyReservationsHref(next, today));
            }}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            tabIndex={-1}
            aria-hidden
          />
        </button>
        <Link href={handyReservationsHref(shiftDate(date, 1), today)} aria-label="次の日" className={navBtn}>
          <ChevronRight className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>
      <div className="flex items-center gap-2">
        {date !== today && (
          <Link
            href={handyReservationsHref(today, today)}
            className="inline-flex h-8 items-center rounded-full border border-[#e5dfd5] bg-white px-3 text-[12px] font-bold text-[#5c5650] active:bg-[#f6ebe3]"
          >
            今日に戻る
          </Link>
        )}
        <span className="flex-1" />
        {canAdd && (
          <Link
            href={handyNewReservationHref(date)}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-[#bc5940] px-3.5 text-[12px] font-bold text-white shadow-[0_3px_10px_#bc59401a] active:bg-[#9f4630]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden />
            予約を追加
            <span className="text-[9.5px] font-semibold text-white/75">Add</span>
          </Link>
        )}
      </div>
    </div>
  );
}
