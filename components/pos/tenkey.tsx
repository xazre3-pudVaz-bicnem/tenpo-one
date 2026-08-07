'use client';

import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'C'] as const;
export type TenkeyKey = (typeof KEYS)[number];

/**
 * 金額入力用テンキー。0-9・00・Cのみのシンプルな設計（長押し不要）。
 * onKey は押されたキーをそのまま渡す（数字は連結、00は0を2つ連結、Cはクリア）。
 * 値の保持・連結ロジックは呼び出し側（componentsのensure/appendDigit）に委ねる。
 */
export function Tenkey({ onKey, disabled }: { onKey: (key: TenkeyKey) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="金額テンキー">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onKey(k)}
          className={cn(
            'flex h-12 items-center justify-center rounded-lg border text-lg font-bold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            k === 'C'
              ? 'border-danger/30 bg-danger-soft text-danger hover:bg-danger-soft/70'
              : 'border-gray-300 bg-white text-navy hover:bg-gray-50 active:bg-gray-100'
          )}
        >
          {k === 'C' ? <Delete className="h-5 w-5" /> : k}
        </button>
      ))}
    </div>
  );
}

/** テンキーの数字連結ロジック（電卓式：既存値の末尾に桁を追加）。最大9桁。 */
export function appendTenkeyDigit(current: number, digit: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'): number {
  const base = current > 0 ? String(current) : '';
  const next = (base + digit).slice(0, 9);
  return Number(next) || 0;
}

export function appendTenkeyDoubleZero(current: number): number {
  return appendTenkeyDigit(appendTenkeyDigit(current, '0'), '0');
}
