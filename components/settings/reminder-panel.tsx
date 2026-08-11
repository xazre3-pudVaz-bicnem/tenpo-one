'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { prepareReservationReminders } from '@/app/app/reservations/reminder-actions';

/**
 * 予約リマインダーの「送信準備」パネル。対象予約を送信キュー（notification_outbox）へ積む。
 * 実送信は外部プロバイダ未接続のため行われない（接続後に配送）。
 */
export function ReminderPanel({ storeId }: { storeId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      try {
        const res = await prepareReservationReminders(storeId);
        setResult(res.message);
        toast('リマインダーを準備しました');
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '準備に失敗しました', 'error');
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle>予約リマインダーの準備</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-600">
          設定した「送信タイミング」に入る予約を送信キューへ積みます（重複しないよう1予約1回）。
        </p>
        <Button onClick={run} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          リマインダーを準備する
        </Button>
        {result && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{result}</p>}
        <p className="text-xs text-amber-600">
          ※ 外部メール/SMSプロバイダは未接続です。実送信は接続後に有効になります（キューは保持されます）。
        </p>
      </CardContent>
    </Card>
  );
}
