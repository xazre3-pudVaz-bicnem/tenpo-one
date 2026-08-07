'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { purchaseToStockQty, purchaseToStockUnitCost, hasCostPrecisionRisk } from '@/lib/units';
import { receiveItems } from '@/app/app/purchases/actions';

export interface ReceivableItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
  /** 在庫連動明細のみ: 在庫単位・仕入単位→在庫単位への変換係数（在庫非連動なら1） */
  stockUnit: string;
  factor: number;
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
          {items.map((item) => {
            const qtyStr = values[item.id]?.quantity ?? '';
            const costStr = values[item.id]?.unitCost ?? '';
            const qtyNum = Number(qtyStr);
            const costNum = Number(costStr);
            const showsConversion = item.factor !== 1;
            const previewValid = showsConversion && Number.isFinite(qtyNum) && qtyNum > 0 && Number.isFinite(costNum) && costNum >= 0;
            const stockQty = previewValid ? purchaseToStockQty(qtyNum, item.factor) : null;
            const stockCost = previewValid ? purchaseToStockUnitCost(costNum, item.factor) : null;
            const priceRisk = previewValid && hasCostPrecisionRisk(costNum, item.factor);
            return (
              <div key={item.id} className="rounded-lg border border-gray-200 p-2">
                <div className="grid grid-cols-12 items-end gap-2">
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
                    <Label className="text-[11px]">今回入荷数量（{item.unit}）</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      disabled={remaining(item) <= 0}
                      value={qtyStr}
                      onChange={(e) => updateValue(item.id, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="col-span-4">
                    <Label className="text-[11px]">単価（円/{item.unit}・変更可）</Label>
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      disabled={remaining(item) <= 0}
                      value={costStr}
                      onChange={(e) => updateValue(item.id, { unitCost: e.target.value })}
                    />
                  </div>
                </div>
                {previewValid && (
                  <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <p>
                      変換プレビュー: {qtyNum}
                      {item.unit} → {stockQty}
                      {item.stockUnit} ／ {yen(costNum)}/{item.unit} → {yen(stockCost)}/{item.stockUnit}
                    </p>
                    {priceRisk && (
                      <p className="mt-1 font-medium text-warning">
                        変換後の在庫単価の丸め誤差が大きくなります。在庫単位の見直しを推奨します
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
