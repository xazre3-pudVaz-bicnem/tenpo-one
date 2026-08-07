'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from '@/lib/features';
import { cn } from '@/lib/utils';
import { createPlan, updatePlan, type PlanInput } from '@/app/admin/plans/actions';

interface PlanFeaturesShape {
  store_limit?: number | null;
  user_limit?: number | null;
  features?: Partial<Record<FeatureKey, boolean>>;
}

interface PlanRow {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  features?: unknown;
}

export function PlanDialog({ plan }: { plan?: PlanRow }) {
  const isEdit = !!plan;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const planFeatures = (plan?.features ?? {}) as PlanFeaturesShape;

  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [monthlyPrice, setMonthlyPrice] = useState(String(plan?.monthly_price ?? 0));
  const [description, setDescription] = useState(plan?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(plan?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [storeLimit, setStoreLimit] = useState(planFeatures.store_limit != null ? String(planFeatures.store_limit) : '');
  const [userLimit, setUserLimit] = useState(planFeatures.user_limit != null ? String(planFeatures.user_limit) : '');
  const [disabledFeatures, setDisabledFeatures] = useState<Set<FeatureKey>>(
    () => new Set(FEATURE_KEYS.filter((k) => planFeatures.features?.[k] === false))
  );
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const toggleFeature = (key: FeatureKey) => {
    setDisabledFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const features: Partial<Record<FeatureKey, boolean>> = {};
    for (const key of disabledFeatures) features[key] = false;
    const input: PlanInput = {
      code,
      name,
      monthlyPrice: Number(monthlyPrice) || 0,
      description,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      storeLimit: storeLimit.trim() === '' ? null : Math.max(0, Number(storeLimit) || 0),
      userLimit: userLimit.trim() === '' ? null : Math.max(0, Number(userLimit) || 0),
      features,
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

          <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
            <div>
              <Label htmlFor="plan-store-limit">店舗数上限</Label>
              <Input
                id="plan-store-limit"
                type="number"
                min={0}
                placeholder="上限なし"
                value={storeLimit}
                onChange={(e) => setStoreLimit(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="plan-user-limit">ユーザー数上限</Label>
              <Input
                id="plan-user-limit"
                type="number"
                min={0}
                placeholder="上限なし"
                value={userLimit}
                onChange={(e) => setUserLimit(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            空欄は上限なし。上限超過はハードブロックせず、企業詳細に警告表示のみ行います（制御方針は今後確定）。
          </p>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">機能の既定値</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {FEATURE_KEYS.map((key) => {
                const enabled = !disabledFeatures.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleFeature(key)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs',
                      enabled ? 'border-gray-200 bg-white text-navy' : 'border-gray-200 bg-gray-50 text-gray-400'
                    )}
                  >
                    <span>{FEATURE_LABELS[key]}</span>
                    <span className={cn('font-medium', enabled ? 'text-success' : 'text-gray-400')}>
                      {enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              OFFにした機能は、企業詳細の「プラン既定を適用」ボタンでその企業のfeature_flagsへ反映できます（自動では反映されません）。
            </p>
          </div>

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
