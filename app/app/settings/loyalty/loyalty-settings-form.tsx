'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveLoyaltySettings, type LoyaltySettingsInput } from './actions';

export function LoyaltySettingsForm({ initial }: { initial: LoyaltySettingsInput }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [yenPerPoint, setYenPerPoint] = useState(initial.yenPerPoint);
  const [pointValue, setPointValue] = useState(initial.pointValue);
  const [expiryMonths, setExpiryMonths] = useState<string>(initial.expiryMonths != null ? String(initial.expiryMonths) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveLoyaltySettings({
        enabled,
        yenPerPoint,
        pointValue,
        expiryMonths: expiryMonths.trim() === '' ? null : Number(expiryMonths),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('ポイント設定を保存しました');
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>ポイント機能</CardTitle>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            有効にする
          </label>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-gray-600">
            会計時に自動付与・返金時に自動取消されます。無効にすると新規のポイント付与・利用は行われません（既存の残高は保持されます）。
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="loyalty-yen-per-point">付与レート（円 / 1pt）</Label>
              <Input
                id="loyalty-yen-per-point"
                type="number"
                min={1}
                value={yenPerPoint}
                onChange={(e) => setYenPerPoint(Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-gray-500">
                会計金額をこの円数で割った数量（切り捨て）のポイントを付与します（例: 100円で1pt）
              </p>
            </div>
            <div>
              <Label htmlFor="loyalty-point-value">利用レート（円 / 1pt）</Label>
              <Input
                id="loyalty-point-value"
                type="number"
                min={1}
                value={pointValue}
                onChange={(e) => setPointValue(Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-gray-500">会計時にポイント払いで使う際の1ptあたりの円換算です（例: 1pt=1円）</p>
            </div>
          </div>

          <div>
            <Label htmlFor="loyalty-expiry">有効期限（ヶ月・空欄で無期限）</Label>
            <Input
              id="loyalty-expiry"
              type="number"
              min={1}
              value={expiryMonths}
              onChange={(e) => setExpiryMonths(e.target.value)}
              className="max-w-[200px]"
              placeholder="無期限"
            />
            <p className="mt-1 text-xs text-gray-500">失効処理は今後対応（現在は期限を設定しても自動失効は行われません）</p>
          </div>

          <FieldError message={error ?? undefined} />

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
