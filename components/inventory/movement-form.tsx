'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { purchaseToStockQty, purchaseToStockUnitCost, hasCostPrecisionRisk } from '@/lib/units';
import { addMovement } from '@/app/app/inventory/actions';
import { MANUAL_MOVEMENT_OPTIONS, MOVEMENT_TYPE_LABELS, movementNeedsReason, type ManualMovementType } from './labels';

export interface MovementFormItem {
  id: string;
  name: string;
  unit: string;
  avgCost: number | null;
  purchaseUnit: string | null;
  purchaseToStockFactor: number;
}

/**
 * 入出庫登録ダイアログ。
 * in=入荷（rpc apply_stock_receipt。単価入力あり・加重平均原価を自動更新）。
 * 品目に仕入単位が設定されている場合、数量・単価は仕入単位で入力し、
 * lib/units の変換関数で在庫単位へ変換してから addMovement を呼ぶ。
 * out/waste/count_adjust=在庫減
 */
export function MovementForm({ item }: { item: MovementFormItem }) {
  const [open, setOpen] = useState(false);
  const [movementType, setMovementType] = useState<ManualMovementType>('in');
  const [quantityInput, setQuantityInput] = useState('');
  const [unitCostInput, setUnitCostInput] = useState(item.avgCost != null ? String(item.avgCost) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const needsReason = movementNeedsReason(movementType);
  const isReceipt = movementType === 'in';
  const factor = item.purchaseToStockFactor > 0 ? item.purchaseToStockFactor : 1;
  const usesPurchaseUnit = isReceipt && !!item.purchaseUnit && factor !== 1;
  const receiptQtyLabel = usesPurchaseUnit ? `仕入数量（${item.purchaseUnit}）` : `数量（${item.unit}）`;
  const receiptCostLabel = usesPurchaseUnit ? `単価（円/${item.purchaseUnit}）` : '単価（円）';

  const qtyNum = Number(quantityInput);
  const costNum = Number(unitCostInput);
  const previewValid = isReceipt && Number.isFinite(qtyNum) && qtyNum > 0 && Number.isFinite(costNum) && costNum >= 0;
  const previewStockQty = previewValid ? purchaseToStockQty(qtyNum, factor) : null;
  const previewStockCost = previewValid ? purchaseToStockUnitCost(costNum, factor) : null;
  const priceRisk = previewValid && hasCostPrecisionRisk(costNum, factor);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(null);
    const quantity = Number(formData.get('quantity'));
    const reason = (formData.get('reason') as string) || null;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('数量を正しく入力してください');
      return;
    }
    if (needsReason && !reason?.trim()) {
      setError('理由を入力してください');
      return;
    }
    let unitCost: number | null = null;
    if (isReceipt) {
      const raw = formData.get('unitCost');
      unitCost = raw != null && raw !== '' ? Number(raw) : null;
      if (unitCost == null || !Number.isFinite(unitCost) || unitCost < 0) {
        setError('単価を正しく入力してください');
        return;
      }
    }
    setBusy(true);
    try {
      await addMovement({ itemId: item.id, movementType, quantity, reason, unitCost });
      toast(isReceipt ? '入荷を登録しました' : '在庫を更新しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        入出庫
      </Button>
      <Dialog open={open} onClose={close} title={`入出庫：${item.name}`}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="mv-type">種別</Label>
            <Select
              id="mv-type"
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as ManualMovementType)}
            >
              {MANUAL_MOVEMENT_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className={isReceipt ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <Label htmlFor="mv-qty">{isReceipt ? receiptQtyLabel : `数量（${item.unit}）`}</Label>
              <Input
                id="mv-qty"
                name="quantity"
                type="number"
                min={0}
                step="0.01"
                required
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
              />
            </div>
            {isReceipt && (
              <div>
                <Label htmlFor="mv-cost">{receiptCostLabel}</Label>
                <Input
                  id="mv-cost"
                  name="unitCost"
                  type="number"
                  min={0}
                  step="1"
                  required
                  value={unitCostInput}
                  onChange={(e) => setUnitCostInput(e.target.value)}
                />
              </div>
            )}
          </div>
          {isReceipt && previewValid && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              <p>
                変換プレビュー: {qtyNum}
                {usesPurchaseUnit ? item.purchaseUnit : item.unit} → {previewStockQty}
                {item.unit} ／ {yen(costNum)}/{usesPurchaseUnit ? item.purchaseUnit : item.unit} → {yen(previewStockCost)}/{item.unit}
              </p>
              {priceRisk && (
                <p className="mt-1 font-medium text-warning">
                  変換後の在庫単価の丸め誤差が大きくなります。在庫単位の見直しを推奨します
                </p>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="mv-reason">理由{needsReason ? '（必須）' : '（任意）'}</Label>
            <Textarea id="mv-reason" name="reason" />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '更新中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
