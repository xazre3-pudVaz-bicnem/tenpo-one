import { Skeleton } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}
