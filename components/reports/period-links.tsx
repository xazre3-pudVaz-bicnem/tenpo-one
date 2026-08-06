import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface PeriodPreset {
  label: string;
  from: string;
  to: string;
}

/** 期間プリセットのリンク群（今日/7日/30日/今月/先月） */
export function PeriodLinks({
  basePath,
  presets,
  currentFrom,
  currentTo,
}: {
  basePath: string;
  presets: PeriodPreset[];
  currentFrom: string;
  currentTo: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="期間プリセット">
      {presets.map((p) => {
        const active = p.from === currentFrom && p.to === currentTo;
        return (
          <Link
            key={p.label}
            href={`${basePath}?from=${p.from}&to=${p.to}`}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
            aria-current={active ? 'true' : undefined}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
