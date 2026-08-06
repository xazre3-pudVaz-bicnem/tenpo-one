'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { startCount } from '@/app/app/inventory/actions';

/** 「棚卸を開始」ボタン。全active品目をスナップショットしてから棚卸入力画面へ遷移する */
export function StartCountButton({ storeId }: { storeId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handle = async () => {
    setBusy(true);
    try {
      const id = await startCount(storeId);
      router.push(`/app/inventory/counts/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '棚卸の開始に失敗しました', 'error');
      setBusy(false);
    }
  };

  return (
    <Button onClick={() => void handle()} disabled={busy}>
      {busy ? '準備中…' : '棚卸を開始'}
    </Button>
  );
}
