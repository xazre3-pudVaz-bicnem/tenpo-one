'use client';

import { useState, useTransition } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updateLeavePolicy } from '@/app/app/leave/actions';

/** 会社の有給付与ルール（organizations.leave_policy）。法定の自動付与テーブルではなく手動運用メモとして提供する */
export function LeavePolicyForm({ initial }: { initial: { expiryYears: number; memo: string } }) {
  const [expiryYears, setExpiryYears] = useState(String(initial.expiryYears));
  const [memo, setMemo] = useState(initial.memo);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const submit = () => {
    const years = Number(expiryYears);
    if (!(years > 0)) {
      setError('失効年数は1以上で入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateLeavePolicy({ expiryYears: years, memo });
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>有給付与ルール</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>法定の自動付与テーブルは専門家確認後にテンプレート提供予定です。現在は手動付与＋会社ルールメモのみ対応しています。</p>
        </div>
        <div className="max-w-xs">
          <Label htmlFor="policy-expiry">既定の失効年数</Label>
          <Input
            id="policy-expiry"
            type="number"
            min="1"
            step="1"
            value={expiryYears}
            onChange={(e) => setExpiryYears(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-400">「付与を登録」ダイアログの失効日の既定値に使用されます</p>
        </div>
        <div>
          <Label htmlFor="policy-memo">会社の有給付与ルールメモ</Label>
          <Textarea
            id="policy-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例: 入社6ヶ月経過後に10日付与。以降は勤続年数に応じて加算（詳細は就業規則を参照）"
          />
        </div>
        <FieldError message={error ?? undefined} />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
