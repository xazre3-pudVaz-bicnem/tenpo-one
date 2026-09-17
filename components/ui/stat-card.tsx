import { cn } from '@/lib/utils';
import { Card } from './card';

/**
 * 集計タイル。en を渡すと英語ラベルを併記する。unit は数値の後ろに小さく出す単位。
 */
export function StatCard({
  label,
  en,
  value,
  unit,
  sub,
  tone,
  className,
}: {
  label: string;
  en?: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  return (
    <Card className={cn('ui-stat p-4', className)}>
      <p className="text-xs font-medium text-gray-500">
        {label}
        {en && <span className="en-inline ml-1">{en}</span>}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'primary' && 'text-primary-deep',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
          (!tone || tone === 'default') && 'text-navy'
        )}
      >
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-gray-500">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </Card>
  );
}
