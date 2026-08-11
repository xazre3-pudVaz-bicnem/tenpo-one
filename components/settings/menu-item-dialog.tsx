'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveMenuItem } from '@/app/app/settings/menu/actions';
import type { CategoryRow } from './category-panel';

export interface MenuItemRow {
  id: string;
  categoryId: string | null;
  name: string;
  nameKana: string;
  description: string;
  itemType: string;
  price: number;
  takeoutPrice: number | null;
  cost: number | null;
  taxRateId: string | null;
  durationMinutes: number | null;
  sellStartTime: string | null;
  sellEndTime: string | null;
  sortOrder: number;
  isSoldOut: boolean;
  status: 'active' | 'hidden' | 'deleted';
  pricePending?: boolean;
}

const ITEM_TYPE_OPTIONS = [
  { value: 'food', label: 'フード' },
  { value: 'drink', label: 'ドリンク' },
  { value: 'course', label: 'コース' },
  { value: 'option', label: 'オプション' },
];

function emptyItem(categoryId: string | null): MenuItemRow {
  return {
    id: '',
    categoryId,
    name: '',
    nameKana: '',
    description: '',
    itemType: 'food',
    price: 0,
    takeoutPrice: null,
    cost: null,
    taxRateId: null,
    durationMinutes: null,
    sellStartTime: null,
    sellEndTime: null,
    sortOrder: 0,
    isSoldOut: false,
    status: 'active',
  };
}

export function MenuItemDialog({
  storeId,
  categories,
  taxRates,
  editing,
  defaultCategoryId,
  onClose,
}: {
  storeId: string;
  categories: CategoryRow[];
  taxRates: { id: string; name: string }[];
  editing: MenuItemRow | null;
  defaultCategoryId: string | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<MenuItemRow>(editing ?? emptyItem(defaultCategoryId));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof MenuItemRow>(key: K, value: MenuItemRow[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('商品名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await saveMenuItem({
        id: editing?.id,
        storeId,
        categoryId: form.categoryId,
        name: form.name,
        nameKana: form.nameKana,
        description: form.description,
        itemType: form.itemType,
        price: form.price,
        takeoutPrice: form.takeoutPrice,
        cost: form.cost,
        taxRateId: form.taxRateId,
        durationMinutes: form.durationMinutes,
        sellStartTime: form.sellStartTime,
        sellEndTime: form.sellEndTime,
        sortOrder: form.sortOrder,
        status: form.status,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editing ? '商品を更新しました' : '商品を追加しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title={editing ? '商品編集' : '商品追加'} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="item-name">商品名</Label>
            <Input id="item-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="item-kana">フリガナ</Label>
            <Input id="item-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="item-desc">説明</Label>
          <Textarea id="item-desc" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="item-category">カテゴリ</Label>
            <Select
              id="item-category"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value || null)}
            >
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="item-type">種別</Label>
            <Select id="item-type" value={form.itemType} onChange={(e) => set('itemType', e.target.value)}>
              {ITEM_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="item-price">価格（円）</Label>
            <Input
              id="item-price"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => set('price', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="item-takeout">テイクアウト価格</Label>
            <Input
              id="item-takeout"
              type="number"
              min={0}
              value={form.takeoutPrice ?? ''}
              onChange={(e) => set('takeoutPrice', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="item-cost">原価</Label>
            <Input
              id="item-cost"
              type="number"
              min={0}
              value={form.cost ?? ''}
              onChange={(e) => set('cost', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="item-tax">税率</Label>
            <Select
              id="item-tax"
              value={form.taxRateId ?? ''}
              onChange={(e) => set('taxRateId', e.target.value || null)}
            >
              <option value="">未設定</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          {form.itemType === 'course' && (
            <div>
              <Label htmlFor="item-duration">コース所要時間（分）</Label>
              <Input
                id="item-duration"
                type="number"
                min={0}
                value={form.durationMinutes ?? ''}
                onChange={(e) => set('durationMinutes', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="item-sell-start">販売開始時刻</Label>
            <Input
              id="item-sell-start"
              type="time"
              value={form.sellStartTime ?? ''}
              onChange={(e) => set('sellStartTime', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="item-sell-end">販売終了時刻</Label>
            <Input
              id="item-sell-end"
              type="time"
              value={form.sellEndTime ?? ''}
              onChange={(e) => set('sellEndTime', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="item-sort">並び順</Label>
            <Input
              id="item-sort"
              type="number"
              value={form.sortOrder}
              onChange={(e) => set('sortOrder', Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={form.status === 'hidden'}
            onChange={(e) => set('status', e.target.checked ? 'hidden' : 'active')}
          />
          非表示にする（POS・予約に表示されません）
        </label>

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
