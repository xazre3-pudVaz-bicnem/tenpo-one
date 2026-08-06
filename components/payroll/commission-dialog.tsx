'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveCommissionRule, type CommissionRuleInput, type TierInput } from '@/app/app/payroll/actions';

export interface CommissionRuleRow {
  id: string;
  name: string;
  target_type: 'personal_sales' | 'store_target';
  profile_id: string | null;
  store_id: string | null;
  method: 'fixed' | 'rate' | 'tiered';
  rate: number | null;
  fixed_amount: number | null;
  tiers: TierInput[] | null;
  basis: 'tax_included' | 'tax_excluded';
  min_amount: number | null;
  max_amount: number | null;
  effective_from: string;
}

const empty = (): CommissionRuleInput => ({
  name: '',
  targetType: 'personal_sales',
  profileId: null,
  storeId: null,
  method: 'rate',
  rate: 2,
  fixedAmount: null,
  tiers: null,
  basis: 'tax_excluded',
  minAmount: null,
  maxAmount: null,
  effectiveFrom: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
});

export function CommissionRuleDialog({
  trigger,
  staffOptions,
  storeOptions,
  existing,
}: {
  trigger: React.ReactNode;
  staffOptions: { id: string; name: string }[];
  storeOptions: { id: string; name: string }[];
  existing?: CommissionRuleRow;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CommissionRuleInput>(
    existing
      ? {
          id: existing.id,
          name: existing.name,
          targetType: existing.target_type,
          profileId: existing.profile_id,
          storeId: existing.store_id,
          method: existing.method,
          rate: existing.rate,
          fixedAmount: existing.fixed_amount,
          tiers: existing.tiers,
          basis: existing.basis,
          minAmount: existing.min_amount,
          maxAmount: existing.max_amount,
          effectiveFrom: existing.effective_from,
        }
      : empty()
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = <K extends keyof CommissionRuleInput>(key: K, value: CommissionRuleInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const tiers = form.tiers ?? [];
  const addTier = () => update('tiers', [...tiers, { from: 0, to: null, rate: 0 }]);
  const updateTier = (i: number, patch: Partial<TierInput>) =>
    update(
      'tiers',
      tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t))
    );
  const removeTier = (i: number) =>
    update(
      'tiers',
      tiers.filter((_, idx) => idx !== i)
    );

  const submit = () => {
    if (!form.name.trim()) {
      setError('ルール名を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveCommissionRule(form);
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onClose={() => setOpen(false)} title={existing ? '歩合ルールを編集' : '歩合ルールを追加'} wide>
        <div className="space-y-4">
          <div>
            <Label htmlFor="cr-name">ルール名</Label>
            <Input id="cr-name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="例: 個人売上歩合" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="cr-target">対象タイプ</Label>
              <Select
                id="cr-target"
                value={form.targetType}
                onChange={(e) => update('targetType', e.target.value as CommissionRuleInput['targetType'])}
              >
                <option value="personal_sales">個人売上</option>
                <option value="store_target">店舗目標達成</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="cr-profile">対象スタッフ</Label>
              <Select id="cr-profile" value={form.profileId ?? ''} onChange={(e) => update('profileId', e.target.value || null)}>
                <option value="">全スタッフ</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="cr-store">対象店舗</Label>
              <Select id="cr-store" value={form.storeId ?? ''} onChange={(e) => update('storeId', e.target.value || null)}>
                <option value="">全店舗</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cr-method">計算方法</Label>
              <Select id="cr-method" value={form.method} onChange={(e) => update('method', e.target.value as CommissionRuleInput['method'])}>
                <option value="rate">料率（%）</option>
                <option value="fixed">固定額</option>
                <option value="tiered">段階料率</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="cr-basis">売上基準</Label>
              <Select id="cr-basis" value={form.basis} onChange={(e) => update('basis', e.target.value as CommissionRuleInput['basis'])}>
                <option value="tax_excluded">税抜売上</option>
                <option value="tax_included">税込売上</option>
              </Select>
            </div>
          </div>

          {form.method === 'rate' && (
            <div>
              <Label htmlFor="cr-rate">料率（%）</Label>
              <Input
                id="cr-rate"
                type="number"
                step="0.001"
                value={form.rate ?? 0}
                onChange={(e) => update('rate', Number(e.target.value))}
              />
            </div>
          )}
          {form.method === 'fixed' && (
            <div>
              <Label htmlFor="cr-fixed">固定額（円）</Label>
              <Input
                id="cr-fixed"
                type="number"
                value={form.fixedAmount ?? 0}
                onChange={(e) => update('fixedAmount', Number(e.target.value))}
              />
            </div>
          )}
          {form.method === 'tiered' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">段階（売上帯域ごとの料率）</Label>
                <Button variant="secondary" size="sm" onClick={addTier}>
                  <Plus className="h-3.5 w-3.5" />
                  段階を追加
                </Button>
              </div>
              <div className="space-y-2">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="下限(円)"
                      value={t.from}
                      onChange={(e) => updateTier(i, { from: Number(e.target.value) })}
                      className="w-28"
                    />
                    <span className="text-xs text-gray-400">〜</span>
                    <Input
                      type="number"
                      placeholder="上限(円・空欄=上限なし)"
                      value={t.to ?? ''}
                      onChange={(e) => updateTier(i, { to: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-36"
                    />
                    <Input
                      type="number"
                      step="0.001"
                      placeholder="料率(%)"
                      value={t.rate}
                      onChange={(e) => updateTier(i, { rate: Number(e.target.value) })}
                      className="w-24"
                    />
                    <button
                      type="button"
                      onClick={() => removeTier(i)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-danger"
                      aria-label="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {tiers.length === 0 && <p className="text-xs text-gray-400">段階が設定されていません</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="cr-min">下限額（円・任意）</Label>
              <Input
                id="cr-min"
                type="number"
                value={form.minAmount ?? ''}
                onChange={(e) => update('minAmount', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="cr-max">上限額（円・任意）</Label>
              <Input
                id="cr-max"
                type="number"
                value={form.maxAmount ?? ''}
                onChange={(e) => update('maxAmount', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="cr-effective">適用開始日</Label>
              <Input
                id="cr-effective"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => update('effectiveFrom', e.target.value)}
              />
            </div>
          </div>

          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
