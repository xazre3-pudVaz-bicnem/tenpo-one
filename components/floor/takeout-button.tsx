'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * テイクアウト（Take out）の注文を始めるボタン。
 * 2026-09-23 要望で、左メニューの「即会計」をやめ、テーブル一覧の中に置いた
 * （店内はテーブルから、持ち帰りはこのボタンから、と同じ画面で選べるようにするため）。
 */
export function TakeoutButton({ startTakeoutAction }: { startTakeoutAction: () => Promise<{ orderId: string }> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      try {
        const { orderId } = await startTakeoutAction();
        router.push(`/app/pos?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'テイクアウトの注文を作れませんでした', 'error');
      }
    });

  return (
    <Button onClick={start} disabled={pending} className="h-10">
      <ShoppingBag className="h-4 w-4" aria-hidden />
      {pending ? '作成中…' : 'テイクアウト / Take out'}
    </Button>
  );
}
