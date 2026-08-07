'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveTablesStep, skipOnboardingStep, type TableStepInput } from '../actions';

export function StepTables({
  storeId,
  existingCount,
  onAdvance,
}: {
  storeId: string | null;
  existingCount: number;
  onAdvance: (next: number) => void;
}) {
  const [rows, setRows] = useState<TableStepInput[]>([{ name: '', capacityMax: 4 }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (i: number, patch: Partial<TableStepInput>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { name: '', capacityMax: 4 }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storeId) return setError('先に店舗情報を登録してください（前のステップへ戻ってください）');
    startTransition(async () => {
      const res = await saveTablesStep(storeId, rows);
      if (res.error) return setError(res.error);
      toast('テーブルを登録しました');
      onAdvance(5);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(5);
      onAdvance(5);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>テーブル・席を登録してください</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {existingCount > 0 && (
            <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary-deep">
              すでに{existingCount}件のテーブルが登録されています。追加が不要な場合は「後で設定する」を押してください。
            </p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">テーブル名</Label>
                <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="例: T1" />
              </div>
              <div className="w-24">
                <Label className="text-xs">席数</Label>
                <Input
                  type="number"
                  min={1}
                  value={r.capacityMax}
                  onChange={(e) => update(i, { capacityMax: Number(e.target.value) || 1 })}
                />
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
