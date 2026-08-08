'use client';

import { useMemo, useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { METHOD_LABELS } from '@/components/cash/labels';
import type { RefundItemInput, RefundKind, RefundMethod } from '@/app/app/orders/actions';

const METHODS: RefundMethod[] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account'];

/** 返金可能な品目1件分（ページ側で「注文数量 − 返金済み数量」等を計算済みのもの） */
export interface RefundableItem {
  orderItemId: string;
  name: string;
  /** 未返金の残数量（注文数量 − refund_itemsの返金済み数量） */
  remainingQty: number;
  /** 未返金の残額（line_total − refund_itemsの返金済み金額。line_totalベースの単価で按分） */
  remainingAmount: number;
}

type Mode = 'amount' | 'items';

interface ItemSelection {
  checked: boolean;
  qty: number;
  restock: boolean;
}

function unitPrice(it: RefundableItem): number {
  return it.remainingQty > 0 ? it.remainingAmount / it.remainingQty : 0;
}

/** 選択数量に対応する返金額（line_totalベースの単価で計算。全量選択時は端数含め残額そのもの） */
function amountForQty(it: RefundableItem, qty: number): number {
  if (qty >= it.remainingQty) return it.remainingAmount;
  return Math.round(unitPrice(it) * qty);
}

export function RefundDialog({
  orderId,
  refundable,
  items,
  refundOrderAction,
}: {
  orderId: string;
  refundable: number;
  items: RefundableItem[];
  refundOrderAction: (
    orderId: string,
    amount: number,
    method: RefundMethod,
    reason: string,
    kind: RefundKind,
    items?: RefundItemInput[]
  ) => Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('amount');
  const [kind, setKind] = useState<RefundKind>('refund');
  const [amount, setAmount] = useState(refundable);
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [reason, setReason] = useState('');
  const [selection, setSelection] = useState<Record<string, ItemSelection>>({});
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    setMode('amount');
    setKind('refund');
    setAmount(refundable);
    setMethod('cash');
    setReason('');
    setSelection({});
    setOpen(true);
  };

  const selectKind = (next: RefundKind) => {
    setKind(next);
    if (next === 'void') {
      // 取消（VOID）は残額全額のみ。品目単位選択は不可・金額は固定。
      setMode('amount');
      setAmount(refundable);
    }
  };

  const toggleItem = (it: RefundableItem, checked: boolean) => {
    setSelection((prev) => ({
      ...prev,
      [it.orderItemId]: checked
        ? { checked: true, qty: it.remainingQty, restock: prev[it.orderItemId]?.restock ?? false }
        : { checked: false, qty: 0, restock: false },
    }));
  };

  const setItemQty = (it: RefundableItem, qty: number) => {
    const clamped = Math.max(0, Math.min(it.remainingQty, qty));
    setSelection((prev) => ({ ...prev, [it.orderItemId]: { ...prev[it.orderItemId], checked: true, qty: clamped, restock: prev[it.orderItemId]?.restock ?? false } }));
  };

  const setItemRestock = (it: RefundableItem, restock: boolean) => {
    setSelection((prev) => ({ ...prev, [it.orderItemId]: { ...prev[it.orderItemId], checked: prev[it.orderItemId]?.checked ?? false, qty: prev[it.orderItemId]?.qty ?? 0, restock } }));
  };

  const selectedItemsPayload: RefundItemInput[] = useMemo(
    () =>
      items
        .filter((it) => selection[it.orderItemId]?.checked && selection[it.orderItemId].qty > 0)
        .map((it) => {
          const sel = selection[it.orderItemId];
          return {
            orderItemId: it.orderItemId,
            quantity: sel.qty,
            amount: amountForQty(it, sel.qty),
            restock: sel.restock,
          };
        }),
    [items, selection]
  );

  const itemsAmount = selectedItemsPayload.reduce((a, it) => a + it.amount, 0);
  const effectiveAmount = mode === 'items' ? itemsAmount : amount;
  const isVoid = kind === 'void';

  const canSubmit =
    !pending &&
    reason.trim().length > 0 &&
    effectiveAmount > 0 &&
    effectiveAmount <= refundable &&
    (mode === 'amount' || selectedItemsPayload.length > 0) &&
    (!isVoid || effectiveAmount === refundable);

  const handleConfirm = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        await refundOrderAction(
          orderId,
          effectiveAmount,
          method,
          reason,
          kind,
          mode === 'items' ? selectedItemsPayload : undefined
        );
        toast(isVoid ? '取消を記録しました' : '返金を記録しました');
        setOpen(false);
      } catch (e) {
        toast(e instanceof Error ? e.message : '処理に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant="danger" className="w-full" onClick={openDialog}>
        返金・取消する
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="返金・取消" wide>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">返金可能額: {yen(refundable)}</p>

          <div>
            <Label>区分</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => selectKind('refund')}
                className={`h-10 flex-1 rounded-lg border text-sm font-medium ${kind === 'refund' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 bg-white text-gray-600'}`}
              >
                返金
              </button>
              <button
                type="button"
                onClick={() => selectKind('void')}
                className={`h-10 flex-1 rounded-lg border text-sm font-medium ${kind === 'void' ? 'border-danger bg-danger-soft text-danger' : 'border-gray-300 bg-white text-gray-600'}`}
              >
                取消（VOID）
              </button>
            </div>
            {isVoid && <p className="mt-1 text-xs text-gray-500">会計の取消。全額のみ返金できます（金額は固定）。</p>}
          </div>

          {!isVoid && (
            <div>
              <Label>返金方法の選択</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('amount')}
                  className={`h-10 flex-1 rounded-lg border text-sm font-medium ${mode === 'amount' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 bg-white text-gray-600'}`}
                >
                  金額指定
                </button>
                <button
                  type="button"
                  onClick={() => setMode('items')}
                  disabled={items.length === 0}
                  className={`h-10 flex-1 rounded-lg border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'items' ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 bg-white text-gray-600'}`}
                >
                  商品単位
                </button>
              </div>
              {mode === 'items' && items.length === 0 && (
                <p className="mt-1 text-xs text-gray-500">返金可能な品目がありません</p>
              )}
            </div>
          )}

          {mode === 'amount' ? (
            <div>
              <Label htmlFor="refund-amount">返金額</Label>
              <Input
                id="refund-amount"
                type="number"
                min={1}
                max={refundable}
                value={amount}
                disabled={isVoid}
                onChange={(e) => setAmount(Math.min(refundable, Math.max(0, Number(e.target.value) || 0)))}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>返金する品目・数量</Label>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
                {items.map((it) => {
                  const sel = selection[it.orderItemId] ?? { checked: false, qty: 0, restock: false };
                  return (
                    <div key={it.orderItemId} className="rounded-lg border border-gray-100 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex flex-1 items-center gap-2 text-sm text-gray-800">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={sel.checked}
                            onChange={(e) => toggleItem(it, e.target.checked)}
                          />
                          <span className="font-medium">{it.name}</span>
                          <span className="text-xs text-gray-500">（未返金 {it.remainingQty}点 / {yen(it.remainingAmount)}）</span>
                        </label>
                        <span className="whitespace-nowrap text-sm font-medium tabular-nums text-navy">
                          {sel.checked ? yen(amountForQty(it, sel.qty)) : '—'}
                        </span>
                      </div>
                      {sel.checked && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 pl-6">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">数量</span>
                            <Input
                              type="number"
                              min={0.01}
                              max={it.remainingQty}
                              step="any"
                              value={sel.qty}
                              onChange={(e) => setItemQty(it, Number(e.target.value) || 0)}
                              className="h-8 w-24"
                            />
                          </div>
                          <label className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                              checked={sel.restock}
                              onChange={(e) => setItemRestock(it, e.target.checked)}
                            />
                            在庫に戻す
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">
                「在庫に戻す」は返品があった場合のみチェックしてください（提供済み・廃棄の場合はチェック不要）。
              </p>
              <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-medium">
                <span>返金合計</span>
                <span className={`tabular-nums ${itemsAmount > refundable ? 'text-danger' : 'text-navy'}`}>{yen(itemsAmount)}</span>
              </div>
              {itemsAmount > refundable && (
                <p className="text-xs text-danger">返金合計が返金可能額（{yen(refundable)}）を超えています</p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="refund-method">返金方法</Label>
            <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="refund-reason">理由（必須・操作履歴に記録されます）</Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="返金・取消の理由を入力してください"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={handleConfirm} disabled={!canSubmit}>
              {pending ? '処理中…' : isVoid ? '取消を確定' : '返金を確定'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
