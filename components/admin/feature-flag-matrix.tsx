'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { FEATURE_KEYS, FEATURE_LABELS } from '@/lib/features';
import { setOrgFeatureFlag } from '@/app/admin/organizations/actions';

/** 企業単位の機能フラグON/OFFマトリクス。行なし=有効の規約に基づき disabledKeys のみOFF表示する */
export function FeatureFlagMatrix({
  organizationId,
  disabledKeys,
}: {
  organizationId: string;
  disabledKeys: string[];
}) {
  const disabled = new Set(disabledKeys);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const handleToggle = (key: string, nextEnabled: boolean) => {
    startTransition(async () => {
      try {
        await setOrgFeatureFlag(organizationId, key, nextEnabled);
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        OFFにすると企業の全ユーザーのナビと画面から即座に機能が消えます。
      </div>
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {FEATURE_KEYS.map((key) => {
          const enabled = !disabled.has(key);
          return (
            <div key={key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy">{FEATURE_LABELS[key]}</p>
                <p className="font-mono text-[11px] text-gray-400">{key}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={FEATURE_LABELS[key]}
                disabled={pending}
                onClick={() => handleToggle(key, !enabled)}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
