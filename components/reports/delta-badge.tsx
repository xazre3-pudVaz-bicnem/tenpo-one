import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Delta } from './compare';

/**
 * 前期間比の増減バッジ。positiveIsGood=false の指標（原価率など「低い方が良い」指標）は
 * 上昇時に危険色で表示する。
 */
export function DeltaBadge({
  delta,
  label,
  positiveIsGood = true,
  className,
}: {
  delta: Delta;
  label: string;
  positiveIsGood?: boolean;
  className?: string;
}) {
  if (delta.pct === null) {
    return <span className={cn('text-xs font-medium text-gray-400', className)}>{label} —</span>;
  }
  const good = delta.direction === 'flat' ? null : positiveIsGood ? delta.direction === 'up' : delta.direction === 'down';
  const Icon = delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : ArrowRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums',
        good == null ? 'text-gray-400' : good ? 'text-success' : 'text-danger',
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {delta.pct >= 0 ? '+' : ''}
      {delta.pct.toFixed(1)}%
      <span className="font-normal text-gray-400">{label}</span>
    </span>
  );
}
