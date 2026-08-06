'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { receiveItems } from '@/app/app/purchases/actions';

export interface ReceivableItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
}

/** 発注明細の入荷登録ダイアログ */
export function ReceiveForm({ poId, items }: { poId: string; items: ReceivableItem[] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const remaining = (item: ReceivableItem) => Math.max(0, item.quantity - item.receivedQuantity);

  const handleSubmit = async () => {
    setError(null);
    const receipts = Object.entries(values)
      .map(([itemId, v]) => ({ itemId, quantity: Number(v) }))
      .filter((r) => r.quantity > 0);
    if (receipts.length === 0) {
      setError('入荷数量を入力してください');
      return;
    }
    setBusy(true);
    try {
      await receiveItems(poId, receipts);
      toast('入荷を登録しました');
      setOpen(false);
      setValues({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '入荷登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>入荷登録</Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title="入荷登録">
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy">{item.name}</p>
                <p className="text-xs text-gray-500">
                  発注 {item.quantity}
                  {item.unit}／入荷済み {item.receivedQuantity}
                  {item.unit}／残り {remaining(item)}
                  {item.unit}
                </p>
              </div>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="w-28"
                placeholder="0"
                disabled={remaining(item) <= 0}
                value={values[item.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
              />
            </div>
          ))}
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              キャンセル
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={busy}>
              {busy ? '登録中…' : '入荷を登録する'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
