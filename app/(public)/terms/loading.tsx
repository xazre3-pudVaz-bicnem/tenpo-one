import { PageSkeleton } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <PageSkeleton />
    </div>
  );
}
