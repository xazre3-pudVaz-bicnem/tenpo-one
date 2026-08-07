'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveCoupon, generateCouponCode, type CouponInput } from './actions';

export interface CouponFormRow {
  id: string;
  code: string;
  name: string;
  kind: 'fixed' | 'percent';
  value: number;
  storeId: string | null;
  targetCategoryId: string | null;
  targetMenuItemId: string | null;
  minTotal: number;
  startsAt: string | null;
  endsAt: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  maxUses: number | null;
  perCustomerLimit: number | null;
  firstVisitOnly: boolean;
  stackable: boolean;
}

export interface StoreOption {
  id: string;
  name: string;
}
export interface CategoryOption {
  id: string;
  name: string;
}
export interface MenuItemOption {
  id: string;
  name: string;
}

type TargetMode = 'none' | 'category' | 'item';

interface FormState {
  code: string;
  name: string;
  kind: 'fixed' | 'percent';
  value: string;
  storeId: string;
  targetMode: TargetMode;
  targetCategoryId: string;
  targetMenuItemId: string;
  minTotal: string;
  startsAt: string;
  endsAt: string;
  timeFrom: string;
  timeTo: string;
  maxUses: string;
  perCustomerLimit: string;
  firstVisitOnly: boolean;
  stackable: boolean;
}

function emptyForm(): FormState {
  return {
    code: '',
    name: '',
    kind: 'fixed',
    value: '',
    storeId: '',
    targetMode: 'none',
    targetCategoryId: '',
    targetMenuItemId: '',
    minTotal: '0',
    startsAt: '',
    endsAt: '',
    timeFrom: '',
    timeTo: '',
    maxUses: '',
    perCustomerLimit: '',
    firstVisitOnly: false,
    stackable: false,
  };
}

function toFormState(row: CouponFormRow): FormState {
  return {
    code: row.code,
    name: row.name,
    kind: row.kind,
    value: String(row.value),
    storeId: row.storeId ?? '',
    targetMode: row.targetCategoryId ? 'category' : row.targetMenuItemId ? 'item' : 'none',
    targetCategoryId: row.targetCategoryId ?? '',
    targetMenuItemId: row.targetMenuItemId ?? '',
    minTotal: String(row.minTotal),
    startsAt: row.startsAt ? row.startsAt.slice(0, 16) : '',
    endsAt: row.endsAt ? row.endsAt.slice(0, 16) : '',
    timeFrom: row.timeFrom ? row.timeFrom.slice(0, 5) : '',
    timeTo: row.timeTo ? row.timeTo.slice(0, 5) : '',
    maxUses: row.maxUses != null ? String(row.maxUses) : '',
    perCustomerLimit: row.perCustomerLimit != null ? String(row.perCustomerLimit) : '',
    firstVisitOnly: row.firstVisitOnly,
    stackable: row.stackable,
  };
}

/** クーポン作成・編集ダイアログ。全項目（migration 00015 coupons テーブル準拠）を編集する */
export function CouponDialog({
  onClose,
  editing,
  stores,
  categories,
  items,
}: {
  onClose: () => void;
  editing: CouponFormRow | null;
  stores: StoreOption[];
  categories: CategoryOption[];
  items: MenuItemOption[];
}) {
  const [form, setForm] = useState<FormState>(() => (editing ? toFormState(editing) : emptyForm()));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleGenerateCode = () => {
    startTransition(async () => {
      const code = await generateCouponCode();
      set('code', code);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: CouponInput = {
      id: editing?.id,
      code: form.code,
      name: form.name,
      kind: form.kind,
      value: Number(form.value),
      storeId: form.storeId || null,
      targetCategoryId: form.targetMode === 'category' ? form.targetCategoryId || null : null,
      targetMenuItemId: form.targetMode === 'item' ? form.targetMenuItemId || null : null,
      minTotal: Number(form.minTotal || 0),
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      timeFrom: form.timeFrom || null,
      timeTo: form.timeTo || null,
      maxUses: form.maxUses.trim() === '' ? null : Number(form.maxUses),
      perCustomerLimit: form.perCustomerLimit.trim() === '' ? null : Number(form.perCustomerLimit),
      firstVisitOnly: form.firstVisitOnly,
      stackable: form.stackable,
    };
    startTransition(async () => {
      const result = await saveCoupon(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? 'クーポンを更新しました' : 'クーポンを作成しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={editing ? 'クーポン編集' : 'クーポン作成'} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="coupon-code">コード</Label>
            <div className="flex gap-2">
              <Input
                id="coupon-code"
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="SUMMER10"
                className="uppercase"
              />
              <Button type="button" variant="secondary" onClick={handleGenerateCode} disabled={pending}>
                自動生成
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="coupon-name">名称</Label>
            <Input id="coupon-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="サマーセール10%OFF" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="coupon-kind">種別</Label>
            <Select id="coupon-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as 'fixed' | 'percent')}>
              <option value="fixed">固定額（円）</option>
              <option value="percent">割引率（%）</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="coupon-value">{form.kind === 'percent' ? '割引率（%）' : '値引き額（円）'}</Label>
            <Input id="coupon-value" type="number" min={1} value={form.value} onChange={(e) => set('value', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-min-total">最低利用額（円）</Label>
            <Input id="coupon-min-total" type="number" min={0} value={form.minTotal} onChange={(e) => set('minTotal', e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="coupon-store">対象店舗</Label>
          <Select id="coupon-store" value={form.storeId} onChange={(e) => set('storeId', e.target.value)}>
            <option value="">全店</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="coupon-target-mode">対象</Label>
          <Select id="coupon-target-mode" value={form.targetMode} onChange={(e) => set('targetMode', e.target.value as TargetMode)}>
            <option value="none">全体</option>
            <option value="category">カテゴリ指定</option>
            <option value="item">商品指定</option>
          </Select>
          {form.targetMode === 'category' && (
            <Select
              aria-label="対象カテゴリ"
              className="mt-2"
              value={form.targetCategoryId}
              onChange={(e) => set('targetCategoryId', e.target.value)}
            >
              <option value="">選択してください</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {form.targetMode === 'item' && (
            <Select
              aria-label="対象商品"
              className="mt-2"
              value={form.targetMenuItemId}
              onChange={(e) => set('targetMenuItemId', e.target.value)}
            >
              <option value="">選択してください</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="coupon-starts">開始日時</Label>
            <Input id="coupon-starts" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-ends">終了日時</Label>
            <Input id="coupon-ends" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-time-from">利用可能時間帯（開始）</Label>
            <Input id="coupon-time-from" type="time" value={form.timeFrom} onChange={(e) => set('timeFrom', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-time-to">利用可能時間帯（終了）</Label>
            <Input id="coupon-time-to" type="time" value={form.timeTo} onChange={(e) => set('timeTo', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-max-uses">利用上限回数（全体・空欄で無制限）</Label>
            <Input id="coupon-max-uses" type="number" min={1} value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="coupon-per-customer">顧客毎の利用上限（空欄で無制限）</Label>
            <Input
              id="coupon-per-customer"
              type="number"
              min={1}
              value={form.perCustomerLimit}
              onChange={(e) => set('perCustomerLimit', e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.firstVisitOnly}
              onChange={(e) => set('firstVisitOnly', e.target.checked)}
            />
            新規顧客限定
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.stackable}
              onChange={(e) => set('stackable', e.target.checked)}
            />
            他の値引きと併用可
          </label>
        </div>

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
