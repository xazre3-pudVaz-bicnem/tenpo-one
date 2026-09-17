import { Skeleton } from '@/components/ui/state';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="読み込み中">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[170px] rounded-[10px]" />
          ))}
        </div>
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    </div>
  );
}
