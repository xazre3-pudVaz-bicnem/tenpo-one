'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 予約登録の選ぶ欄（ハンディ・レジ・PC 共通）。
 * - SelectField：右に ▼ を出す（2026-10-19 Ronnie：コース・予約経路・担当者が選べる欄だと分かるように）
 * - TimeSelect：時と分を別々に選ぶ。分は5分ごと（2026-10-19 Ronnie「選べる時間の分は5分毎で」。
 *   iPhone の時刻の欄は step を無視して1分ごとになるので、自前の選ぶ欄にした）
 */

export const MINUTE_STEP = 5;

/** 分の選択肢（00・05・…・55）。いまの値が5分ごとでないときはその分も入れる（勝手に変えない） */
export function minuteOptions(current?: string): string[] {
  const list = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP).padStart(2, '0'));
  if (current && /^\d{2}$/.test(current) && !list.includes(current)) return [...list, current].sort();
  return list;
}

/** 時の選択肢（00〜23） */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

export function SelectField({
  className,
  children,
  wrapperClassName,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      <select className={cn(className, 'appearance-none pr-8')} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-[#bc5940]" strokeWidth={2.6} />
    </div>
  );
}

export function TimeSelect({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  /** 'HH:MM' */
  value: string;
  onChange: (value: string) => void;
  /** 1つ1つの select に付ける見た目 */
  className?: string;
}) {
  const [h = '18', m = '00'] = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : [];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <SelectField
        id={id}
        aria-label="時"
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m}`)}
        className={className}
        wrapperClassName="flex-1"
      >
        {HOUR_OPTIONS.map((x) => (
          <option key={x} value={x}>
            {x}時
          </option>
        ))}
      </SelectField>
      <SelectField
        aria-label="分"
        value={m}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        className={className}
        wrapperClassName="flex-1"
      >
        {minuteOptions(m).map((x) => (
          <option key={x} value={x}>
            {x}分
          </option>
        ))}
      </SelectField>
    </div>
  );
}
