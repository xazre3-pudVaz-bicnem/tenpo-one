'use client';

import { cn } from '@/lib/utils';

/** 絞り込み用のチップボタン（プロトタイプの .chip-btn）。on で選択状態。 */
export function ChipButton({
  on,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        // 立体的で少し光るタブ（押すと沈む。2026-09-24 店舗要望）
        'tapneon rounded-full border px-3.5 py-1.5 text-[13px] font-semibold',
        on ? 'tapneon-on border-transparent bg-iris text-white' : 'border-line bg-white text-ink-2',
        className
      )}
      {...props}
    />
  );
}
