'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { toggleFeatureFlag } from '@/app/admin/feature-flags/actions';

export function FeatureFlagToggle({
  id,
  organizationId,
  enabled,
}: {
  id: string;
  organizationId: string | null;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const handleToggle = () => {
    startTransition(async () => {
      try {
        await toggleFeatureFlag(id, organizationId, !enabled);
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      onClick={handleToggle}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        enabled ? 'bg-primary' : 'bg-gray-300'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}
