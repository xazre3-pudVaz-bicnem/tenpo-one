'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import {
  FIXED_COST_KINDS,
  FIXED_COST_LABELS,
  MAX_OTHER_COSTS,
  fixedCostTotal,
  type MonthlyCosts,
} from '@/lib/monthly-settlement';
import { saveMonthlyCosts } from '@/app/app/settlement/actions';

/**
 * 家賃・電気・水道・給料・その他 を月ごとに入れる（本部だけ）。
 * 保存すると、その店の月次清算と今週の損益にすぐ反映される。
 */
export function MonthlyCostsForm({
  storeId,
  storeName,
  month,
  initial,
  canEdit,
}: {
  storeId: string;
  storeName: string;
  month: string;
  initial: MonthlyCosts;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<MonthlyCosts>(initial);
  const [saved, setSaved] = useState<MonthlyCosts>(initial);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const setKind = (k: (typeof FIXED_COST_KINDS)[number], v: string) =>
    setForm((f) => ({ ...f, [k]: v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)) }));
  const setOther = (i: number, patch: Partial<{ name: string; amount: number }>) =>
    setForm((f) => ({ ...f, other: f.other.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  const save = () => {
    startTransition(async () => {
      const result = await saveMonthlyCosts(storeId, month, form);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      const cleaned = { ...form, other: form.other.filter((o) => o.name.trim()) };
      setForm(cleaned);
      setSaved(cleaned);
      toast(`${storeName} ${month} の固定費・給料を保存しました`);
    });
  };

  const total = fixedCostTotal(form) + form.salary;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIXED_COST_KINDS.map((k) => (
          <div key={k}>
            <Label htmlFor={`cost-${k}`}>
              {FIXED_COST_LABELS[k].ja}
              <span className="en-inline ml-1">{FIXED_COST_LABELS[k].en}</span>
            </Label>
            <Input
              id={`cost-${k}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={form[k] === 0 ? '' : form[k]}
              placeholder="0"
              disabled={!canEdit || pending}
              onChange={(e) => setKind(k, e.target.value)}
              className="text-right tabular-nums"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-gray-600">
          その他（ガス・通信費・リースなど）
          <span className="en-inline ml-1">Other</span>
        </p>
        {form.other.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`その他 ${i + 1} の名前`}
              value={o.name}
              placeholder="名前（例: ガス）"
              disabled={!canEdit || pending}
              onChange={(e) => setOther(i, { name: e.target.value })}
              className="flex-1"
            />
            <Input
              aria-label={`その他 ${i + 1} の金額`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={o.amount === 0 ? '' : o.amount}
              placeholder="0"
              disabled={!canEdit || pending}
              onChange={(e) => setOther(i, { amount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              className="w-36 text-right tabular-nums"
            />
            {canEdit && (
              <button
                type="button"
                aria-label={`その他 ${i + 1} を消す`}
                disabled={pending}
                onClick={() => setForm((f) => ({ ...f, other: f.other.filter((_, j) => j !== i) }))}
                className="rounded-lg p-2 text-gray-400 hover:bg-danger-soft hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {canEdit && form.other.length < MAX_OTHER_COSTS && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setForm((f) => ({ ...f, other: [...f.other, { name: '', amount: 0 }] }))}
          >
            <Plus className="h-4 w-4" />
            その他を追加
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3">
        <span className="mr-auto text-sm text-gray-600">
          月の合計 <span className="font-bold tabular-nums text-navy">{yen(total)}</span>
          <span className="ml-2 text-xs text-gray-400">（固定費 {yen(fixedCostTotal(form))} ＋ 給料 {yen(form.salary)}）</span>
        </span>
        {canEdit ? (
          <>
            {dirty && <span className="text-xs font-medium text-warning">保存していない変更があります</span>}
            <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => setForm(saved)}>
              元に戻す
            </Button>
            <Button size="sm" disabled={!dirty || pending} onClick={save}>
              {pending ? '保存中…' : 'この月の固定費・給料を保存'}
            </Button>
          </>
        ) : (
          <span className="text-xs text-gray-500">入力は本部（契約企業オーナー・本社管理者・本社経理）のアカウントから</span>
        )}
      </div>
    </div>
  );
}
