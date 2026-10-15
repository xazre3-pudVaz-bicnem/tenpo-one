'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Armchair, ClipboardList, Tag, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HandyReservationRow {
  id: string;
  time: string;
  endTime: string | null;
  name: string;
  /** 電話番号（無ければ null） */
  phone?: string | null;
  partySize: number;
  tableLabel: string;
  sourceLabel: string;
  /** コース（無ければ null） */
  courseName?: string | null;
  status: string;
  statusLabel: string;
  /** 予約確定・来店待ちなど、これから来るもの（濃く出す） */
  upcoming: boolean;
  /** ご要望（お客様から） */
  request?: string | null;
  /** メモ（お店の内部メモ） */
  memo?: string | null;
  /** 前の形（ご要望かメモ）。request・memo が無いときに使う */
  note: string | null;
  /** 着席済みなら、その卓（HANDY で注文へ） */
  tableId: string | null;
}

/** 状態のバッジ（予約一覧のアプリと同じく、これから来るものは枠線、終わったもの・キャンセルは灰色） */
const STATUS_TONE: Record<string, string> = {
  pending: 'border-[#7a7090] text-[#5e5470] bg-white',
  confirmed: 'border-[#4f3868] text-[#4f3868] bg-white',
  waiting: 'border-[#4f3868] text-[#4f3868] bg-white',
  arrived: 'border-[#bd660f] text-[#bd660f] bg-white',
  seated: 'border-[#1e6b4d] bg-[#1e6b4d] text-white',
  billing: 'border-[#bd660f] bg-[#bd660f] text-white',
  completed: 'border-[#8d8599] bg-[#8d8599] text-white',
  cancelled: 'border-[#8d8599] bg-[#8d8599] text-white',
  no_show: 'border-[#b3341f] bg-[#b3341f] text-white',
  waitlisted: 'border-[#7a7090] text-[#5e5470] bg-white',
};

const CANCELLED: ReadonlySet<string> = new Set(['cancelled', 'no_show']);

/**
 * 予約の一覧（2026-10-15 Ronnie「予約一覧をこの形に」。予約アプリの「予約リスト」と同じ並び）：
 *   左：状態・お名前・電話番号 ／ 右：時間〜人数・席・コース・経路・要望・メモ
 *   上：時間順・件数・「キャンセルを除く」
 * ハンディからは閲覧・追加と「HANDYで注文」。変更・来店処理はレジ（管理画面）の予約台帳で行う。
 */
export function HandyReservationList({
  reservations,
  emptyText = '今日の予約はありません。',
}: {
  reservations: HandyReservationRow[];
  emptyText?: string;
}) {
  const [hideCancelled, setHideCancelled] = useState(false);
  const shown = hideCancelled ? reservations.filter((r) => !CANCELLED.has(r.status)) : reservations;

  if (reservations.length === 0) {
    return <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#7a7090]">{emptyText}</p>;
  }

  return (
    <div className="pt-1 pb-4">
      <div className="px-3.5 pt-2 text-[12px] text-[#5e5470]">時間が早い順</div>
      <div className="flex items-center gap-2 px-3.5 pt-1 pb-2">
        <span className="text-[13px] font-bold text-[#2a2138] tabular-nums">{shown.length}件</span>
        <span className="flex-1" />
        <span className="text-[12px] text-[#5e5470]">キャンセルを除く</span>
        <button
          type="button"
          role="switch"
          aria-checked={hideCancelled}
          aria-label="キャンセルを除く"
          onClick={() => setHideCancelled((v) => !v)}
          className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', hideCancelled ? 'bg-[#7b3fe4]' : 'bg-[#cfc7dc]')}
        >
          <span
            className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', hideCancelled ? 'left-[22px]' : 'left-0.5')}
          />
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#7a7090]">キャンセル以外の予約はありません。</p>
      ) : (
        <ul className="space-y-2 px-2.5">
          {shown.map((r) => {
            const cancelled = CANCELLED.has(r.status);
            const request = r.request ?? (r.memo == null ? r.note : null);
            return (
              <li
                key={r.id}
                className={cn(
                  'rounded-[10px] border border-[#e3dbf1] p-3 shadow-[0_1px_3px_#2a213810]',
                  cancelled ? 'bg-[#efedf2]' : 'bg-white',
                  !r.upcoming && !cancelled && 'opacity-80'
                )}
              >
                <div className="flex gap-3">
                  {/* 左：状態・お名前・電話番号 */}
                  <div className="flex w-[42%] min-w-0 shrink-0 flex-col">
                    <span
                      className={cn(
                        'self-start rounded-[4px] border-2 px-2 py-0.5 text-[12px] font-bold',
                        STATUS_TONE[r.status] ?? 'border-[#7a7090] bg-white text-[#5e5470]'
                      )}
                    >
                      {r.statusLabel}
                    </span>
                    <div className="mt-auto pt-3">
                      <b className={cn('block text-[16px] leading-snug font-bold break-words', cancelled ? 'text-[#5e5470]' : 'text-[#2a2138]')}>
                        {r.name} 様
                      </b>
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="mt-0.5 block text-[15px] font-bold tracking-wide text-[#2a2138] tabular-nums">
                          {r.phone}
                        </a>
                      ) : (
                        <span className="mt-0.5 block text-[15px] font-bold text-[#7a7090]">-</span>
                      )}
                    </div>
                  </div>

                  {/* 右：時間〜人数・席・コース・経路・要望・メモ */}
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[16px] font-bold tabular-nums', cancelled ? 'text-[#5e5470]' : 'text-[#2a2138]')}>
                      {r.time}〜 {r.partySize}名
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-[#4f3868]">
                      <Armchair className="h-4 w-4 shrink-0 text-[#7a7090]" aria-hidden />
                      <span className="truncate">{r.tableLabel}</span>
                    </p>
                    <div className="mt-1.5 space-y-1 border-l-2 border-[#d9d2e4] pl-2.5 text-[12px] text-[#5e5470]">
                      <p className="flex items-start gap-1.5">
                        <Utensils className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 break-words">{r.courseName || '-'}</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 break-words">{r.sourceLabel || '-'}</span>
                      </p>
                      <div className="flex items-start gap-1.5">
                        <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <div className="min-w-0 space-y-0.5">
                          <p className="line-clamp-2 break-words">要望：{request || '-'}</p>
                          <p className="line-clamp-2 break-words">メモ：{r.memo || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {r.tableId && !cancelled && (
                  <Link
                    href={`/handy/${r.tableId}`}
                    className="mt-2.5 flex min-h-[40px] items-center justify-center rounded-[9px] border border-[#7b3fe4] text-[13px] font-bold text-[#7b3fe4] active:bg-[#e9e0fa]"
                  >
                    HANDYで注文
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
