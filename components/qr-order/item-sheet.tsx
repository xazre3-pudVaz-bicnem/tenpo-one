'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { yen } from '@/lib/format';
import { qrStrings } from './strings';
import { isPublicImageUrl, type QrMenuItem, type QrMenuModifier } from './types';

/** メニュー商品をタップした際に開く、数量・オプション・メモ入力シート */
export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: QrMenuItem;
  onClose: () => void;
  onAdd: (quantity: number, memo: string, modifiers: QrMenuModifier[]) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [memo, setMemo] = useState('');
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);

  const selectedModifiers = item.modifiers.filter((m) => selectedModifierIds.includes(m.id));
  const unitPrice = item.price + selectedModifiers.reduce((sum, m) => sum + m.price, 0);

  const toggleModifier = (id: string) => {
    setSelectedModifierIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Dialog open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {isPublicImageUrl(item.image_path) && (
          // eslint-disable-next-line @next/next/no-img-element -- 匿名向け公開URLのみ許可されるため next/image の最適化対象外
          <img
            src={item.image_path}
            alt={qrStrings.itemSheet.imageAlt(item.name)}
            className="h-40 w-full rounded-xl object-cover"
          />
        )}

        {item.description && <p className="text-sm text-gray-600">{item.description}</p>}

        {item.allergy_info && (
          <div className="rounded-xl bg-danger-soft px-4 py-3">
            <p className="text-xs font-semibold text-danger">{qrStrings.itemSheet.allergyLabel}</p>
            <p className="mt-0.5 text-sm text-danger">{item.allergy_info}</p>
          </div>
        )}

        <p className="text-lg font-bold tabular-nums text-primary-deep">{yen(item.price)}</p>

        {item.modifiers.length > 0 && (
          <div>
            <Label>{qrStrings.itemSheet.modifiersLabel}</Label>
            <ul className="space-y-1.5 rounded-xl border border-gray-200 p-2">
              {item.modifiers.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                    <span className="flex items-center gap-2 text-sm text-navy">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={selectedModifierIds.includes(m.id)}
                        onChange={() => toggleModifier(m.id)}
                      />
                      {m.name}
                    </span>
                    <span className="text-sm tabular-nums text-gray-500">
                      {m.price > 0 ? `+${yen(m.price)}` : yen(m.price)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
          <span className="text-sm font-medium text-navy">{qrStrings.itemSheet.quantityLabel}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={qrStrings.itemSheet.decreaseAria}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</span>
            <button
              type="button"
              aria-label={qrStrings.itemSheet.increaseAria}
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              disabled={quantity >= 20}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-navy disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="item-memo">{qrStrings.itemSheet.memoLabel}</Label>
          <Textarea
            id="item-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={qrStrings.itemSheet.memoPlaceholder}
            rows={2}
          />
        </div>

        <Button size="lg" className="w-full" onClick={() => onAdd(quantity, memo.trim(), selectedModifiers)}>
          {qrStrings.itemSheet.addToCart(yen(unitPrice * quantity))}
        </Button>
      </div>
    </Dialog>
  );
}
