import { Skeleton } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="読み込み中">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-12 w-64" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
