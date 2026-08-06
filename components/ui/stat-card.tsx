import { cn } from '@/lib/utils';
import { Card } from './card';

export function StatCard({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
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
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </Card>
  );
}
