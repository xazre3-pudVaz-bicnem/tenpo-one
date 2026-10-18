'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Clock, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addMinutesToTime,
  adjustStay,
  ENTRY_STATUSES,
  seatsOf,
  stayLabel,
  tableChoices,
  type BookedSpan,
  type EntryStatus,
  type EntryTable,
  type TableChoice,
} from '@/lib/reservation-entry';

/**
 * 予約登録（ハンディ・レジ共通）の部品。2026-10-19 Ronnie「レストランボードのように」。
 * - TableSuggest：その時間に空いている卓・人数にピッタリの卓（選んだ時間と30分後）
 * - KeywordPicker：キーワード（複数）
 * - StayControl：確保時間（−30・−5・＋5・＋30・元に戻す）
 * - StatusPicker：予約ステータス（来店待ち・仮予約・要連絡）
 */

const label = 'mb-1 flex items-center gap-1.5 text-[12px] font-bold text-[#5c5650]';

/* ------------------------------------------------------------------ 予約可能なテーブル */

export function TableSuggest({
  tables,
  booked,
  date,
  time,
  stayMinutes,
  party,
  today,
  nowMs,
  selected,
  onSelect,
  loading = false,
  excludeReservationId,
  showLater = true,
}: {
  tables: EntryTable[];
  booked: BookedSpan[];
  date: string;
  time: string;
  stayMinutes: number;
  party: number;
  today: string;
  nowMs: number;
  selected: string[];
  /** 卓を選んだ（30分後の卓を押したときは time も変わる） */
  onSelect: (ids: string[], time: string) => void;
  loading?: boolean;
  /** テーブル変更のとき、この予約自身は数えない */
  excludeReservationId?: string;
  /** 30分後の行も出す（テーブル変更では出さない） */
  showLater?: boolean;
}) {
  const [showBusy, setShowBusy] = useState(false);
  const later = addMinutesToTime(time, 30);
  const slots = useMemo(
    () =>
      [time, showLater && later !== time ? later : null]
        .filter((t): t is string => !!t)
        .map((t) => ({
          time: t,
          choices: tableChoices({ tables, booked, date, time: t, stayMinutes, party, today, nowMs, excludeReservationId }),
        })),
    [tables, booked, date, time, later, showLater, stayMinutes, party, today, nowMs, excludeReservationId]
  );
  if (tables.length === 0) return null;

  const pick = (slotTime: string, id: string) => {
    if (slotTime !== time) {
      onSelect([id], slotTime);
      return;
    }
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], time);
  };
  const seats = seatsOf(tables, selected);
  const endLabel = (t: string) => addMinutesToTime(t, stayMinutes);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={label}>
          予約可能なテーブル <span className="text-[10.5px] font-medium text-[#766b62]">（複数選択可）</span>
        </span>
        {loading && <span className="text-[11px] text-[#766b62]">確認中…</span>}
      </div>
      {selected.length > 0 && (
        <p className="mb-1.5 text-[12.5px] font-bold text-[#bc5940]">
          {tables
            .filter((t) => selected.includes(t.id))
            .map((t) => t.name)
            .join(' + ')}
          <span className={cn('ml-1 font-semibold', seats < party ? 'text-[#c62828]' : 'text-[#5c5650]')}>
            ・{seats}名席{seats < party ? `（${party - seats}名分たりません）` : ''}
          </span>
        </p>
      )}
      <div className="space-y-3">
        {slots.map((slot, si) => {
          const free = slot.choices.filter((c) => c.free);
          const busy = slot.choices.filter((c) => !c.free);
          return (
            <div key={slot.time}>
              <p className="mb-1.5 flex items-baseline gap-2 border-l-[3px] border-[#bc5940] pl-2 text-[13px] font-bold text-[#45403b] tabular-nums">
                {slot.time}〜{endLabel(slot.time)}
                {si === 1 && <span className="text-[10.5px] font-medium text-[#766b62]">※押すと開始が30分後になります</span>}
              </p>
              {free.length === 0 ? (
                <p className="rounded-[9px] bg-[#f6efe8] px-3 py-2 text-[12px] text-[#9f4630]">この時間に空いているテーブルはありません</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
                  {free.map((c) => (
                    <TableCard key={c.table.id} c={c} on={slot.time === time && selected.includes(c.table.id)} onClick={() => pick(slot.time, c.table.id)} />
                  ))}
                </div>
              )}
              {si === 0 && busy.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBusy((v) => !v)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#766b62]"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showBusy && 'rotate-180')} aria-hidden />
                  空いていないテーブル（{busy.length}）
                </button>
              )}
              {si === 0 && showBusy && busy.length > 0 && (
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
                  {busy.map((c) => (
                    <TableCard key={c.table.id} c={c} on={false} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableCard({ c, on, onClick }: { c: TableChoice; on: boolean; onClick?: () => void }) {
  const cap = c.table.capacityMin > 1 && c.table.capacityMin !== c.table.capacityMax ? `${c.table.capacityMin}〜${c.table.capacityMax}名` : `${c.table.capacityMax}名`;
  return (
    <button
      type="button"
      disabled={!c.free}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'relative flex min-h-[64px] min-w-0 flex-col items-center justify-center rounded-[10px] border px-1 py-1.5 leading-tight',
        !c.free
          ? 'border-[#e5dfd5] bg-[#efebe5] text-[#9c948a]'
          : on
            ? 'border-transparent bg-[#bc5940] text-white'
            : c.best
              ? 'border-[#bc5940] bg-[#fbefe9] text-[#45403b] active:bg-[#f6e4da]'
              : 'border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3]'
      )}
    >
      {c.best && !on && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-[#bc5940] px-1.5 py-[1px] text-[9.5px] font-bold whitespace-nowrap text-white">
          ピッタリ
        </span>
      )}
      {on && <Check className="absolute top-1 right-1 h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
      <span className="max-w-full truncate text-[14px] font-bold">{c.table.name}</span>
      <span className={cn('text-[10.5px]', on ? 'text-white/85' : 'text-[#766b62]')}>
        {cap}
        {c.table.floorName ? `・${c.table.floorName}` : ''}
      </span>
      {c.free && c.fit === 'small' && <span className={cn('text-[9.5px] font-bold', on ? 'text-white' : 'text-[#c62828]')}>席が足りない</span>}
      {c.free && c.fit === 'big' && <span className={cn('text-[9.5px]', on ? 'text-white/85' : 'text-[#9c948a]')}>大きめ</span>}
      {!c.free && <span className="text-[9.5px] font-bold">{c.reason}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ キーワード */

export function KeywordPicker({
  keywords,
  selected,
  onChange,
}: {
  keywords: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (keywords.length === 0) return null;
  return (
    <div>
      <span className={label}>
        <Tag className="h-3.5 w-3.5" aria-hidden />
        キーワード <span className="text-[10.5px] font-medium text-[#766b62]">（複数選択可）</span>
      </span>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {keywords.map((k) => {
          const on = selected.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== k) : [...selected, k])}
              className={cn(
                'flex min-h-[44px] min-w-0 items-center justify-center rounded-[9px] border px-1.5 py-1 text-center text-[12.5px] leading-tight font-bold',
                on ? 'border-transparent bg-[#bc5940] text-white' : 'border-[#e5dfd5] bg-white text-[#45403b] active:bg-[#f6ebe3]'
              )}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 確保時間 */

export function StayControl({
  minutes,
  defaultMinutes,
  onChange,
}: {
  minutes: number;
  defaultMinutes: number;
  onChange: (m: number) => void;
}) {
  const b =
    'flex h-11 items-center justify-center rounded-[9px] border border-[#e5dfd5] bg-white text-[14px] font-bold text-[#45403b] active:bg-[#f6ebe3] disabled:opacity-40';
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={label}>
          <Clock className="h-3.5 w-3.5" aria-hidden />
          確保時間
        </span>
        {minutes !== defaultMinutes && (
          <button type="button" onClick={() => onChange(defaultMinutes)} className="text-[12px] font-bold text-[#bc5940]">
            元に戻す（{stayLabel(defaultMinutes)}）
          </button>
        )}
      </div>
      <p className="mb-1.5 text-center text-[17px] font-bold text-[#292725] tabular-nums">{stayLabel(minutes)}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {[-30, -5, 5, 30].map((d) => (
          <button key={d} type="button" className={b} onClick={() => onChange(adjustStay(minutes, d))} disabled={(d < 0 && minutes <= 15) || (d > 0 && minutes >= 720)}>
            {d > 0 ? `+${d}分` : `${d}分`}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 予約ステータス */

export function StatusPicker({ value, onChange }: { value: EntryStatus; onChange: (v: EntryStatus) => void }) {
  const tone: Record<EntryStatus, string> = {
    confirmed: 'border-[#45403b] bg-white text-[#292725]',
    pending: 'border-[#bc5940] bg-[#fbefe9] text-[#9f4630]',
    needs_contact: 'border-transparent bg-[#d9573f] text-white',
  };
  return (
    <div>
      <span className={label}>予約ステータス</span>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="予約ステータス">
        {ENTRY_STATUSES.map((s) => {
          const on = value === s.value;
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s.value)}
              className={cn(
                'flex min-h-[48px] flex-col items-center justify-center rounded-[9px] border-2 px-1 leading-tight',
                on ? tone[s.value] : 'border-[#e5dfd5] bg-white text-[#9c948a]'
              )}
            >
              <span className="text-[14px] font-bold">{s.label}</span>
              <span className="text-[9.5px] opacity-80">{s.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
