'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { yen } from '@/lib/format';
import type { QrMenuItem } from './types';

/** メニュー商品をタップした際に開く、数量・メモ入力シート */
export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: QrMenuItem;
  onClose: () => void;
  onAdd: (quantity: number, memo: string) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [memo, setMemo] = useState('');

  return (
    <Dialog open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {item.description && <p className="text-sm text-gray-600">{item.description}</p>}
        <p className="text-lg font-bold tabular-nums text-primary-deep">{yen(item.price)}</p>

        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
          <span className="text-sm font-medium text-navy">数量</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="数量を減らす"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</span>
            <button
              type="button"
              aria-label="数量を増やす"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              disabled={quantity >= 20}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="item-memo">ご要望（任意）</Label>
          <Textarea
            id="item-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例）ネギ抜きでお願いします"
            rows={2}
          />
        </div>

        <Button size="lg" className="w-full" onClick={() => onAdd(quantity, memo.trim())}>
          カートに追加（{yen(item.price * quantity)}）
        </Button>
      </div>
    </Dialog>
  );
}
