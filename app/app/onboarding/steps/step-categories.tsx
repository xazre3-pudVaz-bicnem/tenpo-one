'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveCategoriesStep, skipOnboardingStep, type CategoryStepInput, type CategorySummary } from '../actions';

export function StepCategories({
  storeId,
  onAdvance,
  onCreated,
}: {
  storeId: string | null;
  onAdvance: (next: number) => void;
  onCreated: (created: CategorySummary[]) => void;
}) {
  const [rows, setRows] = useState<CategoryStepInput[]>([{ name: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (i: number, value: string) => setRows((prev) => prev.map((r, idx) => (idx === i ? { name: value } : r)));
  const addRow = () => setRows((prev) => [...prev, { name: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storeId) return setError('先に店舗情報を登録してください（前のステップへ戻ってください）');
    startTransition(async () => {
      const res = await saveCategoriesStep(storeId, rows);
      if (res.error) return setError(res.error);
      onCreated(res.created ?? []);
      toast('カテゴリーを登録しました');
      onAdvance(6);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(6);
      onAdvance(6);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>商品カテゴリーを登録してください</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">例: フード、ドリンク、デザート など</p>
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">カテゴリー名</Label>
                <Input value={r.name} onChange={(e) => update(i, e.target.value)} placeholder="例: フード" />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label="削除" disabled={rows.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            行を追加
          </Button>
          <FieldError message={error ?? undefined} />
        </CardContent>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <Button type="button" variant="secondary" onClick={handleSkip} disabled={pending}>
            後で設定する
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? '保存中…' : '次へ'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
