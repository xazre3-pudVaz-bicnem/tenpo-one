'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createPlan, updatePlan, type PlanInput } from '@/app/admin/plans/actions';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export function PlanDialog({ plan }: { plan?: PlanRow }) {
  const isEdit = !!plan;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [monthlyPrice, setMonthlyPrice] = useState(String(plan?.monthly_price ?? 0));
  const [description, setDescription] = useState(plan?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(plan?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: PlanInput = {
      code,
      name,
      monthlyPrice: Number(monthlyPrice) || 0,
      description,
      sortOrder: Number(sortOrder) || 0,
      isActive,
    };
    startTransition(async () => {
      try {
        if (isEdit) {
          await updatePlan(plan.id, input);
          toast('プランを更新しました');
        } else {
          await createPlan(input);
          toast('プランを作成しました');
        }
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存に失敗しました');
      }
    });
  };

  return (
    <>
      {isEdit ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          プランを追加
        </Button>
      )}

      <Dialog open={open} onClose={close} title={isEdit ? 'プランを編集' : 'プランを追加'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="plan-code">プランコード</Label>
            <Input
              id="plan-code"
              required
              disabled={isEdit}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="standard"
            />
          </div>
          <div>
            <Label htmlFor="plan-name">プラン名</Label>
            <Input id="plan-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="plan-price">月額（円）</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-gray-400">0円の場合は料金ページで「個別見積」と表示されます</p>
            </div>
            <div>
              <Label htmlFor="plan-sort">表示順</Label>
              <Input
                id="plan-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="plan-desc">説明</Label>
            <Textarea id="plan-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            有効（料金ページに表示する）
          </label>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !name || !code}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
