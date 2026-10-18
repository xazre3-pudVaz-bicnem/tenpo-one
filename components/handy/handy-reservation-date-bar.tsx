'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { ReservationCalendarSheet } from '@/components/reservations/entry/reservation-calendar-sheet';
import {
  handyDayLabel,
  handyNewReservationHref,
  handyReservationsHref,
  shiftDate,
} from '@/lib/handy-reservations';

/**
 * ハンディの予約の日付バー（2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」）。
 *   ‹ 前の日 ／ 10/16（木）（押すとカレンダー）／ 次の日 ›、今日でないときは日付の欄の左に「今日」。
 * 「＋ 予約登録」は上のバーの右（更新の横）。2026-10-19 Ronnie「予約の追加は上に。すっきりと」（レストランボードと同じ置き方）
 */
export function HandyReservationDateBar({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  // 日付を押すと日付選択（日ごとの予約人数・休業日・仮予約／要連絡。2026-10-19 Ronnie「レストランボードのように」）
  const [calendarOpen, setCalendarOpen] = useState(false);

  const navBtn =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3]';

  return (
    <div className="px-3 pt-2.5">
      <div className="flex items-center gap-2">
        <Link href={handyReservationsHref(shiftDate(date, -1), today)} aria-label="前の日" className={navBtn}>
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </Link>
        {/* 日付の欄。今日でないときは左に「今日」（押すと今日へ。2026-10-19 Ronnie「今日に戻るはここに 今日 と」） */}
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-[9px] border border-[#ead9cc] bg-[#f9ede6]">
          {date !== today && (
            <Link
              href={handyReservationsHref(today, today)}
              className="ml-1 inline-flex h-8 shrink-0 items-center rounded-[7px] border border-[#ead9cc] bg-white px-2.5 text-[12.5px] font-bold text-[#bc5940] active:bg-[#f6ebe3]"
            >
              今日
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            className="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-[15px] font-bold text-[#45403b] active:bg-[#f6e4da]"
            aria-label="日付を選ぶ"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-[#bc5940]" aria-hidden />
            <span className="truncate tabular-nums">{handyDayLabel(date)}</span>
            {date === today && <span className="shrink-0 text-[10px] font-semibold text-[#bc5940]">今日</span>}
          </button>
        </div>
        {calendarOpen && (
          <ReservationCalendarSheet
            date={date}
            today={today}
            onClose={() => setCalendarOpen(false)}
            onSelect={(d) => {
              setCalendarOpen(false);
              router.push(handyReservationsHref(d, today));
            }}
          />
        )}
        <Link href={handyReservationsHref(shiftDate(date, 1), today)} aria-label="次の日" className={navBtn}>
          <ChevronRight className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/**
 * 上のバーの右の「＋ 予約登録」（更新の横。2026-10-19 Ronnie「予約の追加は上に」）。
 * 見ている日の予約を登録する画面へ。予約の登録の権限が無い人には出さない（ページ側で canAdd を見る）
 */
export function HandyAddReservationButton({ date }: { date: string }) {
  return (
    <Link
      href={handyNewReservationHref(date)}
      aria-label="予約を登録"
      className="flex h-12 w-[50px] flex-col items-center justify-center gap-0.5 text-white max-[350px]:w-[42px] active:opacity-70"
    >
      <Plus className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden />
      <span className="text-[10px] leading-none font-bold">予約登録</span>
    </Link>
  );
}
