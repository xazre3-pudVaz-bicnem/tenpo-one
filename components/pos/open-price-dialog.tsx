'use client';

import { useState } from 'react';
import { Delete } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';

/** レジで打てる金額の上限（サーバーの OPEN_PRICE_MAX と同じ） */
export const OPEN_PRICE_MAX = 9_999_999;

/**
 * ¥0 の商品（キャンセル料・時価など）の金額を、注文画面でその場で打つ
 * （2026-10-05 御茶ノ水 宮崎さん「キャンセル料の金額をこの画面で入力できるといい」）。
 * 会計画面のテンキーと同じ並びの大きなキー（レジは iPad で指で打つ）。値段のある商品は変えられない（値引きは会計で）。
 */
export function OpenPriceDialog({
  itemName,
  initial,
  onClose,
  onConfirm,
}: {
  itemName: string;
  initial: number | null;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}) {
  const [typed, setTyped] = useState<string>(initial != null && initial > 0 ? String(initial) : '');
  const value = typed === '' ? 0 : Number(typed);

  const press = (k: string) => {
    setTyped((cur) => {
      const next = (cur + k).replace(/^0+(?=\d)/, '');
      return Number(next) > OPEN_PRICE_MAX ? cur : next;
    });
  };
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '000'];
  const keyCls = 'h-14 rounded-xl border border-line bg-white text-xl font-bold text-navy active:bg-lilac';

  return (
    <Dialog open onClose={onClose} title="金額を入力 / Enter amount">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          <span className="font-bold text-navy">{itemName}</span> の金額（1つあたり・税込）を入れます。
        </p>
        <div className="flex items-center justify-between rounded-xl bg-lilac px-4 py-3">
          <span className="text-sm font-semibold text-ink-3">金額 / Amount</span>
          <span className="text-3xl font-extrabold tabular-nums text-navy">{yen(value)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <button key={k} type="button" className={keyCls} onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button
            type="button"
            aria-label="1文字消す"
            className={cn(keyCls, 'flex items-center justify-center text-ink-3')}
            onClick={() => setTyped((cur) => cur.slice(0, -1))}
          >
            <Delete className="h-6 w-6" />
          </button>
          <button type="button" className={cn(keyCls, 'col-span-2 text-base text-ink-3')} onClick={() => setTyped('')}>
            クリア / Clear
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="button" onClick={() => onConfirm(value)}>
            決定 / OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
