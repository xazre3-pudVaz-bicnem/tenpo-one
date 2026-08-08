/**
 * Stripe/freee 風の高密度KPIストリップ。
 * 1枚の枠内にセルをグリッド線で区切って並べる（gap-px + 背景色トリックで実装。
 * divide-x と違い、モバイルの2列折返し時も罫線が崩れない）。
 */
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface KpiCell {
  key: string;
  label: string;
  value: React.ReactNode;
  href?: string;
  tone?: 'default' | 'primary';
  /** 前月比・目標比などの比較バッジ（DeltaBadge等）。未指定ならセル内に表示しない */
  compare?: React.ReactNode;
}

export function KpiStrip({
  cells,
  size = 'lg',
  className,
}: {
  cells: KpiCell[];
  size?: 'lg' | 'sm';
  className?: string;
}) {
  const colsClass = cells.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
  const cellClass = cn('flex flex-col gap-1 bg-white px-4', size === 'lg' ? 'py-4' : 'py-2.5');
  const valueClass = (tone?: 'default' | 'primary') =>
    cn('font-bold tabular-nums', size === 'lg' ? 'text-2xl' : 'text-base', tone === 'primary' ? 'text-primary-deep' : 'text-navy');

  return (
    <div className={cn('grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100', colsClass, className)}>
      {cells.map((cell) =>
        cell.href ? (
          <Link key={cell.key} href={cell.href} className={cn(cellClass, 'transition-colors hover:bg-gray-50')}>
            <span className="text-xs font-medium text-gray-500">{cell.label}</span>
            <span className={valueClass(cell.tone)}>{cell.value}</span>
            {cell.compare && <div className="flex flex-wrap items-center gap-2">{cell.compare}</div>}
          </Link>
        ) : (
          <div key={cell.key} className={cellClass}>
            <span className="text-xs font-medium text-gray-500">{cell.label}</span>
            <span className={valueClass(cell.tone)}>{cell.value}</span>
            {cell.compare && <div className="flex flex-wrap items-center gap-2">{cell.compare}</div>}
          </div>
        )
      )}
    </div>
  );
}
