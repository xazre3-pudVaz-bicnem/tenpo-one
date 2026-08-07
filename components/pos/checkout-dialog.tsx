'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { calcChange } from '@/lib/money';
import { METHOD_LABELS } from '@/components/cash/labels';
import type { CheckoutPayment } from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

export interface CheckoutOrder {
  id: string;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  total: number;
}

export interface PosTerminalReader {
  id: string;
  label: string;
  deviceType: string | null;
  isSimulated: boolean;
  status: string;
  lastSeenAt: string | null;
}

export interface PosPaymentAvailability {
  configured: boolean;
  testMode: boolean;
}

const METHODS: CheckoutPayment['method'][] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account'];

/** 端末決済ポーリングの上限（60秒 ÷ 2秒間隔） */
const TERMINAL_POLL_INTERVAL_MS = 2000;
const TERMINAL_POLL_TIMEOUT_MS = 60000;

type TerminalStatus = 'idle' | 'sending' | 'polling' | 'timeout' | 'failed';

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
  terminalReaders,
  paymentAvailability,
  startTerminalPaymentAction,
  checkTerminalPaymentAction,
  cancelTerminalPaymentAction,
  onTerminalPaymentFinalized,
}: {
  open: boolean;
  onClose: () => void;
  order: CheckoutOrder;
  canDiscount: boolean;
  discountReason: string | null;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  onCheckout: (payments: CheckoutPayment[]) => Promise<void>;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  startTerminalPaymentAction: (orderId: string, readerId: string) => Promise<TerminalPaymentState>;
  checkTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  cancelTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  onTerminalPaymentFinalized: () => void;
}) {
  const { toast } = useToast();
  const [discountPending, startDiscount] = useTransition();
  const [checkoutPending, startCheckout] = useTransition();
  const [discountInput, setDiscountInput] = useState(String(order.discountTotal || ''));
  const [discountReasonInput, setDiscountReasonInput] = useState(discountReason ?? '');
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  const [selectedReaderId, setSelectedReaderId] = useState(terminalReaders[0]?.id ?? '');
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>('idle');
  const [terminalIntentId, setTerminalIntentId] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalActionPending, startTerminalAction] = useTransition();
  const elapsedRef = useRef(0);

  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = order.total - paid;
  // 端末決済が進行中/未解決の間は、他の支払方法の操作を排他する
  const terminalBlocking = terminalStatus === 'sending' || terminalStatus === 'polling' || terminalStatus === 'timeout';

  useEffect(() => {
    if (terminalStatus !== 'polling' || !terminalIntentId) return;
    elapsedRef.current = 0;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const result = await checkTerminalPaymentAction(terminalIntentId);
        if (cancelled) return;
        if (!result.ok) {
          setTerminalStatus('failed');
          setTerminalError(result.error ?? '決済状態の確認に失敗しました');
          return;
        }
        if (result.status === 'succeeded' && result.finalized) {
          onTerminalPaymentFinalized();
          return;
        }
        if (result.status === 'failed' || result.status === 'canceled') {
          setTerminalStatus('failed');
          setTerminalError(result.status === 'canceled' ? '決済がキャンセルされました' : '決済が失敗しました');
          return;
        }
        elapsedRef.current += TERMINAL_POLL_INTERVAL_MS;
        if (elapsedRef.current >= TERMINAL_POLL_TIMEOUT_MS) {
          setTerminalStatus('timeout');
        }
      } catch (e) {
        if (cancelled) return;
        setTerminalStatus('failed');
        setTerminalError(e instanceof Error ? e.message : '決済状態の確認に失敗しました');
      }
    }, TERMINAL_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [terminalStatus, terminalIntentId, checkTerminalPaymentAction, onTerminalPaymentFinalized]);

  const handleStartTerminal = () => {
    if (!selectedReaderId) return;
    setTerminalError(null);
    setTerminalStatus('sending');
    startTerminalAction(async () => {
      try {
        const result = await startTerminalPaymentAction(order.id, selectedReaderId);
        if (!result.ok || !result.localIntentId) {
          setTerminalStatus('failed');
          setTerminalError(result.error ?? '決済の開始に失敗しました');
          return;
        }
        setTerminalIntentId(result.localIntentId);
        if (result.status === 'succeeded') {
          const check = await checkTerminalPaymentAction(result.localIntentId);
          if (check.ok && check.status === 'succeeded' && check.finalized) {
            onTerminalPaymentFinalized();
            return;
          }
        }
        setTerminalStatus('polling');
      } catch (e) {
        setTerminalStatus('failed');
        setTerminalError(e instanceof Error ? e.message : '決済の開始に失敗しました');
      }
    });
  };

  const handleCancelTerminal = () => {
    const intentId = terminalIntentId;
    if (!intentId) {
      setTerminalStatus('idle');
      setTerminalError(null);
      return;
    }
    startTerminalAction(async () => {
      try {
        await cancelTerminalPaymentAction(intentId);
      } catch {
        // Stripe側で既に完了/失敗済みの場合は無視して状態をリセットする
      } finally {
        setTerminalStatus('idle');
        setTerminalIntentId(null);
        setTerminalError(null);
      }
    });
  };

  const handleRecheckTerminal = () => {
    if (!terminalIntentId) return;
    setTerminalStatus('polling');
  };

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

  const canConfirm =
    !terminalBlocking && payments.length > 0 && paid === order.total && payments.every((p) => p.amount > 0);

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

  const handleDialogClose = () => {
    if (terminalBlocking) {
      toast('決済処理中は閉じられません。先にキャンセルしてください', 'error');
      return;
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleDialogClose} title="会計" wide>
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

        {paymentAvailability.configured && (
          <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-navy">カード端末で決済</p>
              {paymentAvailability.testMode && <Badge tone="warning">テストモード</Badge>}
            </div>

            {terminalReaders.length === 0 ? (
              <p className="text-xs text-gray-500">
                利用可能な決済端末が登録されていません。設定 &gt; 決済・端末 から登録してください。
              </p>
            ) : terminalStatus === 'idle' ? (
              <div className="space-y-3">
                {terminalReaders.length > 1 ? (
                  <div>
                    <Label htmlFor="terminal-reader">決済端末</Label>
                    <Select
                      id="terminal-reader"
                      value={selectedReaderId}
                      onChange={(e) => setSelectedReaderId(e.target.value)}
                    >
                      {terminalReaders.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                          {r.isSimulated ? '（シミュレーション端末）' : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-navy">
                    <span className="font-medium">{terminalReaders[0].label}</span>
                    {terminalReaders[0].isSimulated && <Badge tone="gray">シミュレーション端末</Badge>}
                  </div>
                )}
                {terminalError && <p className="text-xs text-danger">{terminalError}</p>}
                <Button
                  variant="navy"
                  size="pos"
                  className="w-full"
                  disabled={!selectedReaderId || terminalActionPending}
                  onClick={handleStartTerminal}
                >
                  端末へ送信（{yen(order.total)}）
                </Button>
              </div>
            ) : terminalStatus === 'sending' || terminalStatus === 'polling' ? (
              <div className="flex flex-col items-center gap-3 py-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-gray-600">
                  {terminalStatus === 'sending' ? '端末へ送信しています…' : 'お客様の決済をお待ちしています…'}
                </p>
                <Button variant="secondary" size="sm" onClick={handleCancelTerminal} disabled={terminalActionPending}>
                  キャンセル
                </Button>
              </div>
            ) : terminalStatus === 'timeout' ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-warning">
                  状態の確認がタイムアウトしました。決済は継続している場合があります。
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={handleRecheckTerminal}>
                    状態を再確認
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleCancelTerminal} disabled={terminalActionPending}>
                    キャンセル
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <p className="text-sm text-danger">{terminalError ?? '決済に失敗しました'}</p>
                <Button variant="secondary" size="sm" onClick={handleCancelTerminal} disabled={terminalActionPending}>
                  閉じて他の支払方法を選ぶ
                </Button>
              </div>
            )}
          </div>
        )}

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
              <Button
                key={m}
                variant="secondary"
                size="pos"
                disabled={terminalBlocking}
                onClick={() => addPayment(m)}
              >
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
