import { cn } from '@/lib/utils';
import { Inbox, AlertTriangle, Loader2 } from 'lucide-react';

/** 空状態 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center', className)}>
      <Inbox className="mb-3 h-10 w-10 text-gray-300" />
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** エラー状態 */
export function ErrorState({ message, retry }: { message?: string; retry?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger-soft px-6 py-12 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-danger" />
      <p className="text-sm font-medium text-danger">読み込みに失敗しました</p>
      {message && <p className="mt-1 text-xs text-gray-600">{message}</p>}
      {retry && <div className="mt-4">{retry}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-primary', className)} aria-label="読み込み中" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-gray-200', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
