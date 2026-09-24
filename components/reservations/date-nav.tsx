'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { weekdayJa } from '@/lib/format';
import { cn } from '@/lib/utils';

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-white text-ink-2 transition-colors hover:border-iris hover:text-iris';

/**
 * 店舗台帳の日付ナビ（‹ ［今日］ 2026/09/16（水）▾ ›）。
 * 中央の日付をタップするとカレンダー（input[type=date]）が開く。
 * mode='range' のときは from/to に同じ日付を入れる（予約リスト用）。
 */
export function DateNav({
  date,
  basePath,
  today,
  query = '',
  step = 1,
  mode = 'date',
}: {
  date: string;
  basePath: string;
  /** JSTの今日（サーバーで算出して渡す） */
  today: string;
  /** 追加のクエリ（例: 'view=week'） */
  query?: string;
  /** ‹ › で移動する日数 */
  step?: number;
  mode?: 'date' | 'range';
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const hrefFor = (d: string) => {
    const params = new URLSearchParams(query);
    if (mode === 'range') {
      params.set('from', d);
      params.set('to', d);
    } else {
      params.set('date', d);
    }
    return `${basePath}?${params.toString()}`;
  };

  const isToday = date === today;
  const [y, m, d] = date.split('-').map(Number);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2 print:hidden">
      <Link href={hrefFor(shiftDate(date, -step))} aria-label={step === 7 ? '前の週' : '前日'} className={iconBtn}>
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <Link
        href={hrefFor(today)}
        aria-current={isToday ? 'page' : undefined}
        className={cn(
          'inline-flex h-10 items-center rounded-[9px] border px-3 text-[14px] font-bold transition-colors',
          isToday ? 'border-transparent bg-iris-soft text-royal' : 'border-line bg-white text-iris hover:border-iris'
        )}
      >
        今日
      </Link>
      <div className="relative">
        <button
          type="button"
          onClick={openPicker}
          className="inline-flex h-10 items-center gap-1.5 rounded-[9px] border border-line bg-white px-3.5 text-[15px] font-bold text-ink transition-colors hover:border-iris"
          aria-label="日付を選択"
        >
          <span className="tabular-nums">
            {y}/{pad2(m)}/{pad2(d)}
          </span>
          <span className="text-[14px]">（{weekdayJa(date)}）</span>
          <ChevronDown className="h-4 w-4 text-ink-2" />
        </button>
        <input
          ref={inputRef}
          type="date"
          aria-label="日付"
          tabIndex={-1}
          value={date}
          onChange={(e) => e.target.value && router.push(hrefFor(e.target.value))}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
        />
      </div>
      <Link href={hrefFor(shiftDate(date, step))} aria-label={step === 7 ? '次の週' : '翌日'} className={iconBtn}>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
