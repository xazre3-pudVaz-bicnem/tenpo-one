import { Spinner } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <Spinner />
    </div>
  );
}
