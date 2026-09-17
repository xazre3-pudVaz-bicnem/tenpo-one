'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChipButton } from '@/components/ui/chip';
import { cn } from '@/lib/utils';

export interface LinkChip {
  key: string;
  label: string;
  href: string;
  /** ラベル横に出す件数など */
  count?: number;
}

/** URL（searchParams）で絞り込むチップ列。選択中は royal 地。 */
export function LinkChips({
  chips,
  active,
  size = 'md',
  className,
}: {
  chips: LinkChip[];
  active: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className={cn('flex flex-wrap', size === 'md' ? 'gap-2' : 'gap-1.5', pending && 'opacity-70', className)} role="group" aria-label="絞り込み">
      {chips.map((c) => (
        <ChipButton
          key={c.key}
          on={c.key === active}
          className={size === 'md' ? 'px-4 py-2 text-[13.5px]' : undefined}
          onClick={() => startTransition(() => router.push(c.href))}
        >
          {c.label}
          {c.count != null && <span className="ml-1.5 tabular-nums opacity-75">{c.count}</span>}
        </ChipButton>
      ))}
    </div>
  );
}
