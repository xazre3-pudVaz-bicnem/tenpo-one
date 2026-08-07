'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { generateDailyReport } from './actions';

export function GenerateButton({
  storeId,
  date,
  emphasized,
  label,
}: {
  storeId: string;
  date: string;
  emphasized: boolean;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleClick = async () => {
    setBusy(true);
    try {
      await generateDailyReport(storeId, date);
      toast('日報を生成しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '生成に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant={emphasized ? 'primary' : 'secondary'} onClick={() => void handleClick()} disabled={busy}>
      {busy ? '生成中…' : label}
    </Button>
  );
}
