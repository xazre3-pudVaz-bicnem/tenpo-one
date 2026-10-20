'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Armchair, ClipboardList, Tag, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HandyReservationDetail } from './handy-reservation-detail';
import { TagChips } from '@/components/reservations/entry/tag-chips';

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
  /** キーワード（reservations.tags。2026-10-19） */
  tags?: string[];
  /** 割り当てた卓（テーブル変更の最初の選択） */
  tableIds?: string[];
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
  /* ↓ 詳細のポップアップだけで使う（2026-10-16 Ronnie「予約を押したら詳細をポップアップで」） */
  /** 予約番号 */
  code?: string | null;
  nameKana?: string | null;
  adults?: number | null;
  children?: number | null;
  email?: string | null;
  allergy?: string | null;
  /** 席の希望（テーブル・カウンター・個室など） */
  seatType?: string | null;
  /** 利用目的 */
  purpose?: string | null;
  /** 担当（レジの担当名） */
  clerkName?: string | null;
  cancelReason?: string | null;
  /** 受付日時（10/15 21:30） */
  receivedAt?: string | null;
}

/** 状態のバッジ（予約一覧のアプリと同じく、これから来るものは枠線、終わったもの・キャンセルは灰色） */
const STATUS_TONE: Record<string, string> = {
  pending: 'border-[#766b62] text-[#5c5650] bg-white',
  confirmed: 'border-[#45403b] text-[#45403b] bg-white',
  waiting: 'border-[#45403b] text-[#45403b] bg-white',
  arrived: 'border-[#b7791f] text-[#b7791f] bg-white',
  seated: 'border-[#1e6b4d] bg-[#1e6b4d] text-white',
  billing: 'border-[#b7791f] bg-[#b7791f] text-white',
  completed: 'border-[#8f877e] bg-[#8f877e] text-white',
  cancelled: 'border-[#8f877e] bg-[#8f877e] text-white',
  no_show: 'border-[#c62828] bg-[#c62828] text-white',
  waitlisted: 'border-[#766b62] text-[#5c5650] bg-white',
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
  dateLabel,
  actions,
}: {
  reservations: HandyReservationRow[];
  emptyText?: string;
  /** 詳細のポップアップに出す日付（10/16（金）） */
  dateLabel?: string;
  /** 詳細から 来店・キャンセル・テーブル変更 をする（2026-10-19 Ronnie「レストランボードのように詳細から」）。無ければ見るだけ */
  actions?: { storeId: string; date: string; today: string; canWrite: boolean; canCancel: boolean; staff?: { id: string; name: string }[] };
}) {
  const [hideCancelled, setHideCancelled] = useState(false);
  // 押した予約の詳細（ポップアップ）
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = reservations.find((r) => r.id === openId) ?? null;
  const shown = hideCancelled ? reservations.filter((r) => !CANCELLED.has(r.status)) : reservations;

  if (reservations.length === 0) {
    return <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#766b62]">{emptyText}</p>;
  }

  return (
    <div className="pt-1 pb-4">
      <div className="flex items-center gap-2 px-3.5 pt-1.5 pb-1.5">
        <span className="text-[13px] font-bold text-[#292725] tabular-nums">{shown.length}件</span>
        <span className="text-[11px] text-[#766b62]">時間が早い順</span>
        <span className="flex-1" />
        <span className="text-[11.5px] text-[#5c5650]">キャンセルを除く</span>
        <button
          type="button"
          role="switch"
          aria-checked={hideCancelled}
          aria-label="キャンセルを除く"
          onClick={() => setHideCancelled((v) => !v)}
          className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', hideCancelled ? 'bg-[#bc5940]' : 'bg-[#d9d2c7]')}
        >
          <span
            className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', hideCancelled ? 'left-[18px]' : 'left-0.5')}
          />
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#766b62]">キャンセル以外の予約はありません。</p>
      ) : (
        <ul className="space-y-1.5 px-2">
          {shown.map((r) => {
            const cancelled = CANCELLED.has(r.status);
            const request = r.request ?? (r.memo == null ? r.note : null);
            return (
              <li
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={`${r.name} 様 ${r.time} の予約の詳細`}
                onClick={() => setOpenId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenId(r.id);
                  }
                }}
                className={cn(
                  'cursor-pointer rounded-[9px] border border-[#e5dfd5] px-2.5 py-2 shadow-[0_1px_3px_#29272510] active:scale-[0.99] active:border-[#e8c4b4]',
                  cancelled ? 'bg-[#efebe5]' : 'bg-white',
                  !r.upcoming && !cancelled && 'opacity-80'
                )}
              >
                <div className="flex gap-2.5">
                  {/* 左：状態・お名前・電話番号 */}
                  <div className="flex w-[40%] min-w-0 shrink-0 flex-col">
                    <span
                      className={cn(
                        'self-start rounded-[4px] border-[1.5px] px-1.5 py-px text-[10.5px] font-bold',
                        STATUS_TONE[r.status] ?? 'border-[#766b62] bg-white text-[#5c5650]'
                      )}
                    >
                      {r.statusLabel}
                    </span>
                    <div className="pt-1.5">
                      <b className={cn('block text-[14px] leading-snug font-bold break-words', cancelled ? 'text-[#5c5650]' : 'text-[#292725]')}>
                        {r.name} 様
                      </b>
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block text-[12.5px] font-bold text-[#292725] tabular-nums"
                        >
                          {r.phone}
                        </a>
                      ) : (
                        <span className="block text-[12.5px] font-bold text-[#766b62]">-</span>
                      )}
                    </div>
                  </div>

                  {/* 右：時間〜人数・席・コース・経路・要望・メモ */}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className={cn('text-[14px] font-bold tabular-nums', cancelled ? 'text-[#5c5650]' : 'text-[#292725]')}>
                        {r.time}〜 {r.partySize}名
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-[12px] font-bold text-[#45403b]">
                        <Armchair className="h-3.5 w-3.5 shrink-0 text-[#766b62]" aria-hidden />
                        <span className="truncate">{r.tableLabel}</span>
                      </span>
                    </p>
                    <div className="mt-1 space-y-px border-l-2 border-[#ddd5ca] pl-2 text-[11px] leading-[1.45] text-[#5c5650]">
                      <p className="flex items-center gap-1">
                        <Utensils className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">{r.courseName || '-'}</span>
                      </p>
                      <p className="flex items-center gap-1">
                        <Tag className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">{r.sourceLabel || '-'}</span>
                      </p>
                      <div className="flex items-start gap-1">
                        <ClipboardList className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="truncate">要望：{request || '-'}</p>
                          <p className="truncate">メモ：{r.memo || '-'}</p>
                        </div>
                      </div>
                    </div>
                    <TagChips tags={r.tags} className="mt-1" />
                  </div>
                </div>
                {r.tableId && !cancelled && (
                  <Link
                    href={`/handy/${r.tableId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 flex min-h-[36px] items-center justify-center rounded-[8px] border border-[#bc5940] text-[12.5px] font-bold text-[#bc5940] active:bg-[#f6e4da]"
                  >
                    HANDYで注文
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {opened && (
        <HandyReservationDetail
          reservation={opened}
          statusTone={STATUS_TONE[opened.status] ?? 'border-[#766b62] bg-white text-[#5c5650]'}
          dateLabel={dateLabel}
          actions={actions}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
