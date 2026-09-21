'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface HandyReservationRow {
  id: string;
  time: string;
  endTime: string | null;
  name: string;
  partySize: number;
  tableLabel: string;
  sourceLabel: string;
  status: string;
  statusLabel: string;
  /** 予約確定・来店待ちなど、これから来るもの（濃く出す） */
  upcoming: boolean;
  note: string | null;
  /** 着席済みなら、その卓（HANDY で注文へ） */
  tableId: string | null;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-[#efeaf8] text-[#5e4777]',
  confirmed: 'bg-[#7b3fe4] text-white',
  waiting: 'bg-[#7b3fe4] text-white',
  arrived: 'bg-[#fbefdf] text-[#bd660f]',
  seated: 'bg-[#dff3ea] text-[#1e6b4d]',
  billing: 'bg-[#fbefdf] text-[#bd660f]',
  completed: 'bg-[#eee8f6] text-[#8a769d]',
  cancelled: 'bg-[#f7e3e0] text-[#b3341f]',
  no_show: 'bg-[#f7e3e0] text-[#b3341f]',
  waitlisted: 'bg-[#efeaf8] text-[#5e4777]',
};

/**
 * 今日の予約（承認済みレイアウトの RESERVATION）。
 * ハンディからは閲覧と「HANDYで注文」だけ。登録・変更・来店処理はレジ（管理画面）の予約台帳で行う。
 */
export function HandyReservationList({ reservations }: { reservations: HandyReservationRow[] }) {
  if (reservations.length === 0) {
    return (
      <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#8a769d]">
        今日の予約はありません。
      </p>
    );
  }

  return (
    <ul className="space-y-2.5 px-3 pt-2.5 pb-4">
      {reservations.map((r) => (
        <li
          key={r.id}
          className={cn(
            'rounded-[10px] border border-[#e3dbf1] bg-white p-3',
            !r.upcoming && 'opacity-70'
          )}
        >
          <div className="flex items-start gap-3">
            <time className="shrink-0 pt-0.5 text-[15px] font-bold text-[#4f3868] tabular-nums">
              {r.time}
              {r.endTime && (
                <small className="block text-[9px] font-normal text-[#8a769d]">〜{r.endTime}</small>
              )}
            </time>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm font-bold text-[#2a2138]">{r.name} 様</b>
              <p className="mt-0.5 text-[11px] text-[#7a7090]">
                {r.partySize}名 · {r.tableLabel} · {r.sourceLabel}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                STATUS_TONE[r.status] ?? 'bg-[#efeaf8] text-[#5e4777]'
              )}
            >
              {r.statusLabel}
            </span>
          </div>
          {r.note && (
            <p className="mt-2 rounded-lg bg-[#f6f3fb] px-2.5 py-1.5 text-[11px] leading-relaxed break-words text-[#5e4777]">
              {r.note}
            </p>
          )}
          {r.tableId && (
            <Link
              href={`/handy/${r.tableId}`}
              className="mt-2.5 flex min-h-[40px] items-center justify-center rounded-[9px] border border-[#7b3fe4] text-[13px] font-bold text-[#7b3fe4] active:bg-[#efe5ff]"
            >
              HANDYで注文
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
