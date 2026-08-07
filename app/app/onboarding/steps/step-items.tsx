'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveMenuItemsStep, skipOnboardingStep, type MenuItemStepInput } from '../actions';

export function StepItems({
  storeId,
  categories,
  existingCount,
  onAdvance,
}: {
  storeId: string | null;
  categories: { id: string; name: string }[];
  existingCount: number;
  onAdvance: (next: number) => void;
}) {
  const [rows, setRows] = useState<MenuItemStepInput[]>([{ categoryId: categories[0]?.id ?? null, name: '', price: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (i: number, patch: Partial<MenuItemStepInput>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { categoryId: categories[0]?.id ?? null, name: '', price: 0 }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storeId) return setError('先に店舗情報を登録してください（前のステップへ戻ってください）');
    startTransition(async () => {
      const res = await saveMenuItemsStep(storeId, rows);
      if (res.error) return setError(res.error);
      toast('商品を登録しました（税率10%を自動適用しました）');
      onAdvance(7);
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(7);
      onAdvance(7);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>商品を登録してください</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {existingCount > 0 && (
            <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary-deep">
              すでに{existingCount}件の商品が登録されています。
            </p>
          )}
          <p className="text-xs text-gray-500">
            税率は標準税率10%（内税）が自動適用されます。軽減税率対象などの詳細設定は「設定 &gt; メニュー」から行えます。
          </p>
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="w-32">
                <Label className="text-xs">カテゴリー</Label>
                <Select value={r.categoryId ?? ''} onChange={(e) => update(i, { categoryId: e.target.value || null })}>
                  <option value="">未分類</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs">商品名</Label>
                <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="例: 唐揚げ定食" />
              </div>
              <div className="w-28">
                <Label className="text-xs">価格（円）</Label>
                <Input type="number" min={0} value={r.price} onChange={(e) => update(i, { price: Number(e.target.value) || 0 })} />
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
