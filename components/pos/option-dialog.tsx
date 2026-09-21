'use client';

import { useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FieldError } from '@/components/ui/input';
import { yen } from '@/lib/format';

export interface PosOptionItem {
  id: string;
  name: string;
  /** 設定 > 選択肢 の英語名。無ければ日本語のみ表示する */
  nameEn?: string | null;
  price: number;
}

export interface PosOptionGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  items: PosOptionItem[];
}

/**
 * 商品に選択肢グループが設定されている場合に出す選択ダイアログ。
 * 必須・最小/最大はここでも制御するが、確定時の検証はサーバー側でも行う。
 */
export function OptionDialog({
  itemName,
  itemNameEn,
  basePrice,
  groups,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  /** 英語名。日本語を読まないスタッフ向けに見出しの下へ併記する */
  itemNameEn?: string | null;
  basePrice: number;
  groups: PosOptionGroup[];
  onCancel: () => void;
  onConfirm: (optionItemIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const toggle = (group: PosOptionGroup, optionId: string) => {
    setError(null);
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      // 1つだけ選ぶグループは置き換え、複数可なら上限まで追加
      if (group.maxSelect === 1) return { ...prev, [group.id]: [optionId] };
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  };

  const allIds = useMemo(() => Object.values(selected).flat(), [selected]);

  const extraPrice = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      for (const id of selected[g.id] ?? []) {
        sum += g.items.find((i) => i.id === id)?.price ?? 0;
      }
    }
    return sum;
  }, [groups, selected]);

  const handleConfirm = () => {
    for (const g of groups) {
      const count = (selected[g.id] ?? []).length;
      const min = g.isRequired ? Math.max(1, g.minSelect) : g.minSelect;
      if (count < min) {
        setError(`「${g.name}」は${min}つ以上選んでください / Choose at least ${min}`);
        return;
      }
    }
    onConfirm(allIds);
  };

  return (
    <Dialog open onClose={onCancel} title={itemName}>
      <div className="space-y-4">
        {itemNameEn && <p className="-mt-2 text-sm text-gray-500">{itemNameEn}</p>}
        {groups.map((g) => {
          const chosen = selected[g.id] ?? [];
          return (
            <div key={g.id}>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-sm font-semibold text-navy">{g.name}</p>
                {g.isRequired ? <Badge tone="danger">必須 / Required</Badge> : <Badge tone="gray">任意 / Optional</Badge>}
                <span className="text-xs text-gray-500">
                  {g.maxSelect === 1 ? '1つ選択 / Choose 1' : `${g.minSelect}〜${g.maxSelect}つ選択 / Choose ${g.minSelect}–${g.maxSelect}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((o) => {
                  const active = chosen.includes(o.id);
                  const full = !active && g.maxSelect > 1 && chosen.length >= g.maxSelect;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(g, o.id)}
                      disabled={full}
                      className={[
                        'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                        active
                          ? 'border-primary bg-primary-soft font-semibold text-primary-deep'
                          : 'border-gray-200 bg-white text-navy hover:bg-gray-50',
                        full ? 'cursor-not-allowed opacity-40' : '',
                      ].join(' ')}
                    >
                      <span className="block">{o.name}</span>
                      {o.nameEn && <span className="block text-xs text-gray-500">{o.nameEn}</span>}
                      {o.price !== 0 && <span className="text-xs text-gray-500">+{yen(o.price)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <FieldError message={error ?? undefined} />

        {/* スマホ（ハンディ）では縦に積む。横並びのままだと金額とボタンが重なる */}
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-600">
            小計 / Subtotal <span className="text-base font-bold text-navy">{yen(basePrice + extraPrice)}</span>
            {extraPrice > 0 && <span className="ml-1 text-xs text-gray-500">（追加 +{yen(extraPrice)}）</span>}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onCancel}>
              キャンセル / Cancel
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={handleConfirm}>
              追加する / Add
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
