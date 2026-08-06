import { Skeleton } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28" />
      <Skeleton className="h-96" />
    </div>
  );
}
