import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SegmentedTab {
  key: string;
  label: string;
  en?: string;
  href: string;
}

/**
 * 画面上部のタブ（白い枠の中で選択中だけ紫のグラデーション）。
 * リンクで切り替えるため、searchParams やパスに応じて active を渡す。
 */
export function SegmentedTabs({
  tabs,
  active,
  className,
}: {
  tabs: SegmentedTab[];
  active: string;
  className?: string;
}) {
  return (
    <nav
      className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1', className)}
      aria-label="表示切替"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex shrink-0 flex-col items-center rounded-lg px-3.5 py-1.5 text-center text-sm leading-tight font-bold whitespace-nowrap transition-colors',
              on ? 'on-brand text-white' : 'text-ink-2 hover:bg-lilac-soft hover:text-royal'
            )}
          >
            {t.label}
            {t.en && (
              <span className={cn('font-[family-name:var(--font-num)] text-[10.5px] font-semibold', on ? 'text-white/80' : 'text-ink-3')}>
                {t.en}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
