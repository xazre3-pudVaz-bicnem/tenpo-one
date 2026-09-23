'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { startTakeout } from '@/app/app/pos/actions';

/**
 * 「テイクアウト」の行。押すと持ち帰りの伝票を作って注文画面へ行く。
 * 2026-09-24 要望でテーブル一覧の上のボタンをやめ、ホームのメニュー一覧（伝票明細の上）に移した。
 * リンクではなく押したときに伝票を作るので、先読みで伝票ができないようボタンにしている。
 */
export function TakeoutRow({ className, children }: { className: string; children: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const { orderId } = await startTakeout();
            router.push(`/app/pos?order=${orderId}`);
          } catch (e) {
            toast(e instanceof Error ? e.message : 'テイクアウトの注文を作れませんでした', 'error');
          }
        })
      }
    >
      {children}
    </button>
  );
}
