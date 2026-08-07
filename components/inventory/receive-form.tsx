'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { receiveItems } from '@/app/app/purchases/actions';

export interface ReceivableItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
}

interface LineValue {
  quantity: string;
  unitCost: string;
}

/** 発注明細の入荷登録ダイアログ。rpc apply_stock_receipt で在庫数量と加重平均仕入単価を更新する */
export function ReceiveForm({ poId, items }: { poId: string; items: ReceivableItem[] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, LineValue>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { quantity: '', unitCost: String(i.unitCost) }]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const remaining = (item: ReceivableItem) => Math.max(0, item.quantity - item.receivedQuantity);

  const updateValue = (itemId: string, patch: Partial<LineValue>) => {
    setValues((v) => ({ ...v, [itemId]: { ...v[itemId], ...patch } }));
  };

  const handleSubmit = async () => {
    setError(null);
    const receipts = Object.entries(values)
      .map(([itemId, v]) => ({ itemId, quantity: Number(v.quantity), unitCost: Number(v.unitCost) }))
      .filter((r) => r.quantity > 0);
    if (receipts.length === 0) {
      setError('入荷数量を入力してください');
      return;
    }
    if (receipts.some((r) => !Number.isFinite(r.unitCost) || r.unitCost < 0)) {
      setError('単価を正しく入力してください');
      return;
    }
    setBusy(true);
    try {
      await receiveItems(poId, receipts);
      toast('入荷を登録しました');
      setOpen(false);
      setValues(Object.fromEntries(items.map((i) => [i.id, { quantity: '', unitCost: String(i.unitCost) }])));
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
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title="入荷登録" wide>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-gray-200 p-2">
              <div className="col-span-5 min-w-0">
                <p className="truncate text-sm font-medium text-navy">{item.name}</p>
                <p className="text-xs text-gray-500">
                  発注 {item.quantity}
                  {item.unit}／入荷済み {item.receivedQuantity}
                  {item.unit}／残り {remaining(item)}
                  {item.unit}
                </p>
              </div>
              <div className="col-span-3">
                <Label className="text-[11px]">今回入荷数量</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  disabled={remaining(item) <= 0}
                  value={values[item.id]?.quantity ?? ''}
                  onChange={(e) => updateValue(item.id, { quantity: e.target.value })}
                />
              </div>
              <div className="col-span-4">
                <Label className="text-[11px]">単価（円・変更可）</Label>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  disabled={remaining(item) <= 0}
                  value={values[item.id]?.unitCost ?? ''}
                  onChange={(e) => updateValue(item.id, { unitCost: e.target.value })}
                />
              </div>
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
