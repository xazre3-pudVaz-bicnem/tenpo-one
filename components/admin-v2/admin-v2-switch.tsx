'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { setAdminV2 } from '@/app/app/admin-v2-actions';

/**
 * 「新しい管理画面を試す」／「元の管理画面に戻す」（会社のオーナーのパソコンだけに出す。lib/admin-v2.ts）
 */
export function AdminV2Switch({ on, className }: { on: boolean; className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
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
          const res = await setAdminV2(!on);
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
