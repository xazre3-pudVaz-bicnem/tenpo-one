'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { calcChange } from '@/lib/money';
import { METHOD_LABELS } from '@/components/cash/labels';
import type { CheckoutPayment } from '@/app/app/pos/actions';

export interface CheckoutOrder {
  id: string;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  total: number;
}

const METHODS: CheckoutPayment['method'][] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account'];

interface PaymentRow extends CheckoutPayment {
  key: string;
}

export function CheckoutDialog({
  open,
  onClose,
  order,
  canDiscount,
  discountReason,
  setDiscountAction,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  order: CheckoutOrder;
  canDiscount: boolean;
  discountReason: string | null;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  onCheckout: (payments: CheckoutPayment[]) => Promise<void>;
}) {
  const { toast } = useToast();
  const [discountPending, startDiscount] = useTransition();
  const [checkoutPending, startCheckout] = useTransition();
  const [discountInput, setDiscountInput] = useState(String(order.discountTotal || ''));
  const [discountReasonInput, setDiscountReasonInput] = useState(discountReason ?? '');
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = order.total - paid;

  const applyDiscount = () => {
    const amount = Math.max(0, Number(discountInput) || 0);
    startDiscount(async () => {
      try {
        await setDiscountAction(order.id, amount, discountReasonInput);
      } catch (e) {
        toast(e instanceof Error ? e.message : '値引きの適用に失敗しました', 'error');
      }
    });
  };

  const addPayment = (method: CheckoutPayment['method']) => {
    const amount = Math.max(0, remaining);
    setPayments((rows) => [
      ...rows,
      { key: `${method}-${Date.now()}`, method, amount, tendered: method === 'cash' ? amount : undefined },
    ]);
  };

  const updatePayment = (key: string, patch: Partial<PaymentRow>) => {
    setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removePayment = (key: string) => {
    setPayments((rows) => rows.filter((r) => r.key !== key));
  };

  const canConfirm = payments.length > 0 && paid === order.total && payments.every((p) => p.amount > 0);

  const handleConfirm = () => {
    startCheckout(async () => {
      try {
        await onCheckout(
          payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            tendered: p.method === 'cash' ? p.tendered : undefined,
          }))
        );
        onClose();
        setPayments([]);
      } catch (e) {
        toast(e instanceof Error ? e.message : '会計の確定に失敗しました', 'error');
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="会計" wide>
      <div className="space-y-5">
        <div className="rounded-xl bg-surface p-4 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>小計</span>
            <span className="tabular-nums">{yen(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>消費税</span>
            <span className="tabular-nums">{yen(order.taxTotal)}</span>
          </div>
          {order.serviceCharge > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>サービス料</span>
              <span className="tabular-nums">{yen(order.serviceCharge)}</span>
            </div>
          )}
          {order.discountTotal > 0 && (
            <div className="flex justify-between text-warning">
              <span>値引き</span>
              <span className="tabular-nums">-{yen(order.discountTotal)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-gray-200 pt-1.5 text-lg font-bold text-navy">
            <span>合計</span>
            <span className="tabular-nums">{yen(order.total)}</span>
          </div>
        </div>

        {canDiscount && (
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-2 text-sm font-semibold text-navy">値引き</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="discount-amount">値引き額</Label>
                <Input
                  id="discount-amount"
                  type="number"
                  min={0}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <Label htmlFor="discount-reason">理由</Label>
                <Input
                  id="discount-reason"
                  value={discountReasonInput}
                  onChange={(e) => setDiscountReasonInput(e.target.value)}
                  placeholder="端数調整・サービス等"
                />
              </div>
              <Button variant="secondary" onClick={applyDiscount} disabled={discountPending}>
                値引きを適用
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-navy">支払方法</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {METHODS.map((m) => (
              <Button key={m} variant="secondary" size="pos" onClick={() => addPayment(m)}>
                {METHOD_LABELS[m]}
              </Button>
            ))}
          </div>
        </div>

        {payments.length > 0 && (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 p-3">
                <Badge tone="navy" className="shrink-0">
                  {METHOD_LABELS[p.method]}
                </Badge>
                <Input
                  type="number"
                  min={0}
                  value={p.amount}
                  onChange={(e) => updatePayment(p.key, { amount: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-28"
                />
                {p.method === 'cash' && (
                  <>
                    <Label className="mb-0 whitespace-nowrap text-xs">預り金</Label>
                    <Input
                      type="number"
                      min={0}
                      value={p.tendered ?? 0}
                      onChange={(e) =>
                        updatePayment(p.key, { tendered: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-28"
                    />
                    <span className="text-xs text-gray-500 tabular-nums">
                      お釣り {yen(calcChange(p.amount, p.tendered ?? 0))}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => removePayment(p.key)}
                  className="ml-auto rounded p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl bg-navy px-4 py-3 text-white">
          <span className="text-sm">残額</span>
          <span className="text-lg font-bold tabular-nums">{yen(remaining)}</span>
        </div>

        <Button
          size="pos"
          className="w-full"
          disabled={!canConfirm || checkoutPending}
          onClick={handleConfirm}
        >
          {checkoutPending ? '処理中…' : '会計を確定'}
        </Button>
      </div>
    </Dialog>
  );
}
