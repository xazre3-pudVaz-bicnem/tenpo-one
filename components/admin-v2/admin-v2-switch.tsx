'use client';

import { useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { isIpadDesktopMode } from '@/lib/admin-v2';
import { setAdminV2 } from '@/app/app/admin-v2-actions';

const noSubscribe = () => () => {};
/** 画面のタッチの数（サーバーでは分からないので -1） */
const touchPointsSnapshot = () => (typeof navigator === 'undefined' ? -1 : navigator.maxTouchPoints || 0);
const serverSnapshot = () => -1;

/**
 * 「新しい管理画面を試す」／「元の管理画面に戻す」（会社のオーナーのパソコンだけに出す。lib/admin-v2.ts）。
 * 「試す」は、タッチの数が分かってから、パソコンのときだけ出す（Mac を名乗る iPad の Safari には出さない）。
 * 「元に戻す」はいつでも出す。
 */
export function AdminV2Switch({ on, className }: { on: boolean; className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const touchPoints = useSyncExternalStore(noSubscribe, touchPointsSnapshot, serverSnapshot);

  if (!on) {
    if (touchPoints < 0) return null;
    if (isIpadDesktopMode(typeof navigator === 'undefined' ? null : navigator.userAgent, touchPoints)) return null;
  }

  return (
    <button
      type="button"
      disabled={pending}
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-wisteria px-3 py-2 text-[13px] font-bold text-royal hover:bg-lilac-soft disabled:opacity-50',
        className
      )}
      onClick={() =>
        startTransition(async () => {
          const res = await setAdminV2(!on, Math.max(0, touchPoints));
          if (!res.ok) {
            toast(res.error, 'error');
            return;
          }
          router.push('/app/dashboard');
          router.refresh();
        })
      }
    >
      {on ? <Undo2 className="h-4 w-4" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
      {on ? '元の管理画面に戻す' : '新しい管理画面を試す'}
    </button>
  );
}
