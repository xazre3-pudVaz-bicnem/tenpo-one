'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { savePayrollRule, type AllowanceInput, type PayrollRuleInput } from '@/app/app/payroll/actions';

export interface PayrollRuleRow {
  id: string;
  profile_id: string;
  store_id: string | null;
  pay_type: 'monthly' | 'hourly' | 'daily';
  base_amount: number;
  overtime_rate: number;
  night_rate: number;
  holiday_rate: number;
  commute_allowance: number;
  allowances: AllowanceInput[];
  closing_day: number;
  payment_day: number;
  effective_from: string;
}

const empty = (profileId: string): PayrollRuleInput => ({
  profileId,
  storeId: null,
  payType: 'hourly',
  baseAmount: 0,
  overtimeRate: 1.25,
  nightRate: 0.25,
  holidayRate: 1.35,
  commuteAllowance: 0,
  allowances: [],
  closingDay: 31,
  paymentDay: 25,
  effectiveFrom: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
});

export function PayrollRuleDialog({
  trigger,
  staffOptions,
  storeOptions,
  existing,
}: {
  trigger: React.ReactNode;
  staffOptions: { id: string; name: string }[];
  storeOptions: { id: string; name: string }[];
  existing?: PayrollRuleRow;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PayrollRuleInput>(
    existing
      ? {
          id: existing.id,
          profileId: existing.profile_id,
          storeId: existing.store_id,
          payType: existing.pay_type,
          baseAmount: existing.base_amount,
          overtimeRate: existing.overtime_rate,
          nightRate: existing.night_rate,
          holidayRate: existing.holiday_rate,
          commuteAllowance: existing.commute_allowance,
          allowances: existing.allowances ?? [],
          closingDay: existing.closing_day,
          paymentDay: existing.payment_day,
          effectiveFrom: existing.effective_from,
        }
      : empty(staffOptions[0]?.id ?? '')
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = <K extends keyof PayrollRuleInput>(key: K, value: PayrollRuleInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const addAllowance = () =>
    update('allowances', [...form.allowances, { name: '', amount: 0, per: 'month' }]);
  const updateAllowance = (i: number, patch: Partial<AllowanceInput>) =>
    update(
      'allowances',
      form.allowances.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    );
  const removeAllowance = (i: number) =>
    update(
      'allowances',
      form.allowances.filter((_, idx) => idx !== i)
    );

  const submit = () => {
    if (!form.profileId) {
      setError('対象スタッフを選択してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await savePayrollRule(form);
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onClose={() => setOpen(false)} title={existing ? '給与ルールを編集' : '給与ルールを追加'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rule-profile">対象スタッフ</Label>
              <Select
                id="rule-profile"
                value={form.profileId}
                disabled={!!existing}
                onChange={(e) => update('profileId', e.target.value)}
              >
                <option value="">選択してください</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rule-store">適用店舗</Label>
              <Select id="rule-store" value={form.storeId ?? ''} onChange={(e) => update('storeId', e.target.value || null)}>
                <option value="">全店舗共通</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="rule-type">給与形態</Label>
              <Select id="rule-type" value={form.payType} onChange={(e) => update('payType', e.target.value as PayrollRuleInput['payType'])}>
                <option value="hourly">時給</option>
                <option value="monthly">月給</option>
                <option value="daily">日給</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rule-base">基本額（円）</Label>
              <Input
                id="rule-base"
                type="number"
                min={0}
                value={form.baseAmount}
                onChange={(e) => update('baseAmount', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rule-commute">交通費/日（円）</Label>
              <Input
                id="rule-commute"
                type="number"
                min={0}
                value={form.commuteAllowance}
                onChange={(e) => update('commuteAllowance', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rule-effective">適用開始日</Label>
              <Input
                id="rule-effective"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => update('effectiveFrom', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="rule-ot">残業倍率</Label>
              <Input
                id="rule-ot"
                type="number"
                step="0.01"
                value={form.overtimeRate}
                onChange={(e) => update('overtimeRate', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rule-night">深夜加算</Label>
              <Input
                id="rule-night"
                type="number"
                step="0.01"
                value={form.nightRate}
                onChange={(e) => update('nightRate', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rule-holiday">休日倍率</Label>
              <Input
                id="rule-holiday"
                type="number"
                step="0.01"
                value={form.holidayRate}
                onChange={(e) => update('holidayRate', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rule-closing">締め日</Label>
              <Input
                id="rule-closing"
                type="number"
                min={1}
                max={31}
                value={form.closingDay}
                onChange={(e) => update('closingDay', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rule-payment">支払日</Label>
              <Input
                id="rule-payment"
                type="number"
                min={1}
                max={31}
                value={form.paymentDay}
                onChange={(e) => update('paymentDay', Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">手当</Label>
              <Button variant="secondary" size="sm" onClick={addAllowance}>
                <Plus className="h-3.5 w-3.5" />
                手当を追加
              </Button>
            </div>
            <div className="space-y-2">
              {form.allowances.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="手当名"
                    value={a.name}
                    onChange={(e) => updateAllowance(i, { name: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    placeholder="金額"
                    value={a.amount}
                    onChange={(e) => updateAllowance(i, { amount: Number(e.target.value) })}
                    className="w-28"
                  />
                  <Select
                    value={a.per}
                    onChange={(e) => updateAllowance(i, { per: e.target.value as 'month' | 'day' })}
                    className="w-24"
                  >
                    <option value="month">月額</option>
                    <option value="day">日額</option>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeAllowance(i)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-danger"
                    aria-label="削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {form.allowances.length === 0 && <p className="text-xs text-gray-400">手当はありません</p>}
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
