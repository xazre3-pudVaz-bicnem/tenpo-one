'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import type { PosOrderItem } from './pos-screen';
import type { SplitMove } from '@/app/app/pos/actions';

export function SplitDialog({
  open,
  onClose,
  orderId,
  items,
  splitOrderAction,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  items: PosOrderItem[];
  splitOrderAction: (orderId: string, moves: SplitMove[]) => Promise<{ newOrderId: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ newOrderId: string } | null>(null);
  // 二度押し対策: pending state に加えて同期フラグでも多重送信を防ぐ
  const inFlightRef = useRef(false);

  const setQty = (itemId: string, qty: number, max: number) => {
    setSelected((s) => {
      const v = Math.max(0, Math.min(max, qty));
      const next = { ...s };
      if (v === 0) delete next[itemId];
      else next[itemId] = v;
      return next;
    });
  };

  const moves = useMemo<SplitMove[]>(
    () => Object.entries(selected).map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
    [selected]
  );
  const canConfirm = moves.length > 0 && !pending;

  const handleConfirm = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        const res = await splitOrderAction(orderId, moves);
        setResult(res);
        setSelected({});
        toast('伝票を分割しました', 'success');
      } catch (e) {
        toast(
          e instanceof Error ? e.message : '処理に失敗しました。通信状態を確認して再度お試しください',
          'error'
        );
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  const handleClose = () => {
    setResult(null);
    setSelected({});
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="伝票分割" wide>
      {result ? (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm text-navy">新しい伝票を作成しました。</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={handleClose}>
              この伝票のまま続ける
            </Button>
            <Button
              onClick={() => {
                const newOrderId = result.newOrderId;
                handleClose();
                router.push(`/app/pos?order=${newOrderId}`);
              }}
            >
              新しい伝票を開く
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            人数分に分けてそれぞれ会計できます。移動する品目と数量を選択してください（数量の一部だけを移動することもできます）。
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400">移動できる品目がありません</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
              {items.map((it) => {
                const qty = selected[it.id] ?? 0;
                return (
                  <li key={it.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-navy">{it.name}</p>
                      <p className="text-xs text-gray-500">
                        {yen(it.unit_price)} × {it.quantity}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label="移動数量を減らす"
                        onClick={() => setQty(it.id, qty - 1, it.quantity)}
                        disabled={qty <= 0 || pending}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-12 text-center text-sm font-semibold tabular-nums">
                        {qty} / {it.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="移動数量を増やす"
                        onClick={() => setQty(it.id, qty + 1, it.quantity)}
                        disabled={qty >= it.quantity || pending}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              {pending ? '処理中…' : '分割する'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
