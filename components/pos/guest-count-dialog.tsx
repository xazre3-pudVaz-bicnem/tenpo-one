'use client';

import { useRef, useState, useTransition } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const MAX_GUESTS = 999;
/** よくある人数はワンタップで決められるようにする（iPadの現場操作を速くするため） */
const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

/**
 * 会計前の注文の人数を変更するダイアログ。
 * 注文を取った後に人数が変わる（合流・先に帰る）のは日常的なので、
 * 数字入力ではなく大きな ± と定番人数のワンタップで直せるようにしている。
 */
export function GuestCountDialog({
  open,
  onClose,
  orderId,
  currentGuestCount,
  setGuestCountAction,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  currentGuestCount: number;
  setGuestCountAction: (orderId: string, guestCount: number) => Promise<void>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // 呼び出し側は開いている間だけこのコンポーネントを描画するため、
  // マウント時の初期値がそのまま「開いたときの現在人数」になる（開くたびに入力はリセットされる）。
  const [value, setValue] = useState(currentGuestCount);
  const inFlightRef = useRef(false);

  const clamp = (n: number) => Math.min(MAX_GUESTS, Math.max(1, Math.floor(n) || 1));

  const handleConfirm = () => {
    if (inFlightRef.current) return;
    const next = clamp(value);
    if (next === currentGuestCount) {
      onClose();
      return;
    }
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        await setGuestCountAction(orderId, next);
        toast(`人数を ${next}名 に変更しました`, 'success');
        onClose();
      } catch (e) {
        toast(
          e instanceof Error ? e.message : '人数の変更に失敗しました。通信状態を確認して再度お試しください',
          'error'
        );
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="人数の変更 / Change guests">
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          現在 {currentGuestCount}名 / Now {currentGuestCount} guests。人数を変えても合計金額は変わりません / Total does not change.
        </p>

        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            aria-label="1名減らす"
            onClick={() => setValue((v) => clamp(v - 1))}
            disabled={pending || value <= 1}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 text-navy transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <Minus className="h-7 w-7" />
          </button>
          <div className="flex min-w-[6rem] items-baseline justify-center gap-1">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_GUESTS}
              value={value}
              onChange={(e) => setValue(clamp(Number(e.target.value)))}
              disabled={pending}
              aria-label="人数"
              className="w-24 rounded-xl border border-gray-300 bg-white py-2 text-center text-4xl font-bold tabular-nums text-navy focus:border-primary focus:outline-2 focus:outline-primary/30"
            />
            <span className="text-xl font-semibold text-gray-500">名</span>
          </div>
          <button
            type="button"
            aria-label="1名増やす"
            onClick={() => setValue((v) => clamp(v + 1))}
            disabled={pending || value >= MAX_GUESTS}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 text-navy transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {QUICK_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n)}
              disabled={pending}
              className={cn(
                'rounded-xl border py-3 text-base font-semibold transition-colors disabled:opacity-50',
                value === n
                  ? 'border-primary bg-primary-soft text-primary-deep'
                  : 'border-gray-200 text-navy hover:bg-gray-50'
              )}
            >
              {n}名
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル / Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={pending}>
            {pending ? '変更中…' : '変更する / Update'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
