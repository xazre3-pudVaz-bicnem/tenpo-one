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
        'rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
        on ? 'border-royal bg-royal text-white' : 'border-line bg-white text-ink-2 hover:bg-lilac-soft',
        className
      )}
      {...props}
    />
  );
}
