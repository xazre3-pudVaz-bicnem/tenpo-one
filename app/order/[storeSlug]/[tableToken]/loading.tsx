import { Spinner } from '@/components/ui/state';

export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-lilac-soft">
      <Spinner />
    </div>
  );
}
