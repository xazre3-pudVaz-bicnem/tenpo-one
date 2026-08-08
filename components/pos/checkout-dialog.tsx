'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Trash2, Ticket, X as XIcon } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { calcChange } from '@/lib/money';
import { METHOD_LABELS } from '@/components/cash/labels';
import { Tenkey, appendTenkeyDigit, appendTenkeyDoubleZero } from './tenkey';
import type { CheckoutPayment, ApplyCouponResult } from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

const COUPON_PREFIX = 'クーポン: ';
const QUICK_CASH_AMOUNTS = [1000, 5000, 10000] as const;

export interface CheckoutOrder {
  id: string;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  couponCode: string | null;
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

/** ポイント払いの活性条件（顧客紐付け・会員機能有効・残高>0）はサーバーで判定してprops経由で渡す */
export interface PointsAvailability {
  available: boolean;
  balance: number;
  /** 1pt=何円か（loyalty_settings.point_value） */
  pointValue: number;
}

const BASE_METHODS: CheckoutPayment['method'][] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account'];

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
  applyCouponAction,
  clearCouponAction,
  onCheckout,
  terminalReaders,
  paymentAvailability,
  pointsAvailability,
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
  applyCouponAction: (orderId: string, code: string, force?: boolean) => Promise<ApplyCouponResult>;
  clearCouponAction: (orderId: string) => Promise<void>;
  onCheckout: (payments: CheckoutPayment[]) => Promise<void>;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  pointsAvailability: PointsAvailability;
  startTerminalPaymentAction: (orderId: string, readerId: string) => Promise<TerminalPaymentState>;
  checkTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  cancelTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  onTerminalPaymentFinalized: () => void;
}) {
  const { toast } = useToast();
  const [discountPending, startDiscount] = useTransition();
  const [couponPending, startCoupon] = useTransition();
  const [checkoutPending, startCheckout] = useTransition();
  const [discountInput, setDiscountInput] = useState(String(order.discountTotal || ''));
  const isCouponReason = (discountReason ?? '').startsWith(COUPON_PREFIX);
  const [couponMode, setCouponMode] = useState(isCouponReason);
  const [couponCodeInput, setCouponCodeInput] = useState(order.couponCode ?? '');
  const [couponConfirmOpen, setCouponConfirmOpen] = useState(false);
  const [discountReasonInput, setDiscountReasonInput] = useState(
    isCouponReason ? '' : (discountReason ?? '')
  );
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  // 二度押し・連打対策: pending state に加えて同期フラグでも多重送信を防ぐ
  const checkoutInFlightRef = useRef(false);

  const [selectedReaderId, setSelectedReaderId] = useState(terminalReaders[0]?.id ?? '');
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>('idle');
  const [terminalIntentId, setTerminalIntentId] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalActionPending, startTerminalAction] = useTransition();
  const elapsedRef = useRef(0);

  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = order.total - paid;
  const maxPointsUsable = Math.min(pointsAvailability.balance * pointsAvailability.pointValue, order.total);
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
    if (amount > 0 && !discountReasonInput.trim()) {
      toast('値引き理由を入力してください', 'error');
      return;
    }
    startDiscount(async () => {
      try {
        await setDiscountAction(order.id, amount, discountReasonInput);
      } catch (e) {
        toast(e instanceof Error ? e.message : '値引きの適用に失敗しました', 'error');
      }
    });
  };

  const runApplyCoupon = (force: boolean) => {
    const code = couponCodeInput.trim();
    if (!code) {
      toast('クーポンコードを入力してください', 'error');
      return;
    }
    startCoupon(async () => {
      try {
        const result = await applyCouponAction(order.id, code, force);
        if (!result.ok) {
          if (result.requiresReplace) {
            setCouponConfirmOpen(true);
            return;
          }
          toast(result.error ?? 'クーポンの適用に失敗しました', 'error');
          return;
        }
        toast(`クーポン「${result.name}」を適用しました（-${yen(result.discount ?? 0)}）`, 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'クーポンの適用に失敗しました', 'error');
      }
    });
  };

  const handleClearCoupon = () => {
    startCoupon(async () => {
      try {
        await clearCouponAction(order.id);
        setCouponCodeInput('');
        toast('クーポンを解除しました', 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'クーポンの解除に失敗しました', 'error');
      }
    });
  };

  const addPayment = (method: CheckoutPayment['method']) => {
    const cap = method === 'points' ? Math.min(maxPointsUsable, Math.max(0, remaining)) : Math.max(0, remaining);
    setPayments((rows) => [
      ...rows,
      { key: `${method}-${Date.now()}`, method, amount: cap, tendered: method === 'cash' ? cap : undefined },
    ]);
  };

  const updatePayment = (key: string, patch: Partial<PaymentRow>) => {
    setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removePayment = (key: string) => {
    setPayments((rows) => rows.filter((r) => r.key !== key));
  };

  // 合計0円（値引き・クーポンで満額オフになった等）の場合は支払行なしで確定できるようにする。
  // 従来は「支払行が1件以上」かつ「各行の金額>0」を必須としていたため、0円会計が
  // 支払方法を追加できず（追加しても上限0円で金額>0にできない）会計を確定できなかった。
  const canConfirm =
    !terminalBlocking &&
    paid === order.total &&
    (order.total === 0 ? payments.length === 0 : payments.length > 0 && payments.every((p) => p.amount > 0));

  const handleConfirm = () => {
    // disabled属性の反映を待たず、同一フレーム内の連打でも1回しか送信しない
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
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
        toast(
          e instanceof Error ? e.message : '処理に失敗しました。通信状態を確認して再度お試しください',
          'error'
        );
      } finally {
        checkoutInFlightRef.current = false;
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
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-navy">値引き・クーポン</p>
              <div className="flex gap-1 rounded-full bg-gray-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCouponMode(false)}
                  className={cn(
                    'rounded-full px-3 py-1 font-medium transition-colors',
                    !couponMode ? 'bg-white text-navy shadow-sm' : 'text-gray-500'
                  )}
                >
                  値引き
                </button>
                <button
                  type="button"
                  onClick={() => setCouponMode(true)}
                  className={cn(
                    'rounded-full px-3 py-1 font-medium transition-colors',
                    couponMode ? 'bg-white text-navy shadow-sm' : 'text-gray-500'
                  )}
                >
                  クーポン
                </button>
              </div>
            </div>

            {couponMode ? (
              isCouponReason ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary-soft/50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-primary-deep">
                    <Ticket className="h-4 w-4" />
                    <span className="font-medium">{(discountReason as string).slice(COUPON_PREFIX.length)}</span>
                    <span className="tabular-nums">-{yen(order.discountTotal)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearCoupon}
                    disabled={couponPending}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                    解除
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <Label htmlFor="coupon-code">クーポンコード</Label>
                    <Input
                      id="coupon-code"
                      value={couponCodeInput}
                      onChange={(e) => setCouponCodeInput(e.target.value)}
                      placeholder="例: WELCOME500"
                    />
                  </div>
                  <Button variant="secondary" onClick={() => runApplyCoupon(false)} disabled={couponPending}>
                    {couponPending ? '確認中…' : 'クーポンを適用'}
                  </Button>
                </div>
              )
            ) : (
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
                  {discountPending ? '処理中…' : '値引きを適用'}
                </Button>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-navy">支払方法</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {BASE_METHODS.map((m) => (
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
            <Button
              variant="secondary"
              size="pos"
              disabled={terminalBlocking || !pointsAvailability.available}
              title={
                pointsAvailability.available
                  ? `残高 ${pointsAvailability.balance}pt`
                  : '顧客紐付け・会員機能有効・残高が必要です'
              }
              onClick={() => addPayment('points')}
            >
              {METHOD_LABELS.points}
            </Button>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.key} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="navy" className="shrink-0">
                    {METHOD_LABELS[p.method]}
                  </Badge>
                  <Input
                    type="number"
                    min={0}
                    max={p.method === 'points' ? maxPointsUsable : undefined}
                    value={p.amount}
                    onChange={(e) => {
                      const cap = p.method === 'points' ? maxPointsUsable : Number.MAX_SAFE_INTEGER;
                      const v = Math.max(0, Math.min(cap, Number(e.target.value) || 0));
                      updatePayment(p.key, { amount: v, tendered: p.method === 'cash' ? p.tendered : undefined });
                    }}
                    className="w-28"
                  />
                  {p.method === 'points' && (
                    <span className="text-xs text-gray-500 tabular-nums">上限 {yen(maxPointsUsable)}</span>
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

                {p.method === 'cash' && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="mb-0">預り金</Label>
                        <span className="text-sm font-bold tabular-nums text-navy">{yen(p.tendered ?? 0)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_CASH_AMOUNTS.map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() =>
                              updatePayment(p.key, { tendered: (p.tendered ?? 0) + amt })
                            }
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:bg-gray-50"
                          >
                            +{yen(amt)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => updatePayment(p.key, { tendered: p.amount })}
                          className="rounded-lg border border-primary/40 bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary-deep hover:bg-primary-soft/70"
                        >
                          ちょうど
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 tabular-nums">
                        お釣り {yen(calcChange(p.amount, p.tendered ?? 0))}
                      </p>
                    </div>
                    <Tenkey
                      onKey={(k) => {
                        const current = p.tendered ?? 0;
                        if (k === 'C') updatePayment(p.key, { tendered: 0 });
                        else if (k === '00') updatePayment(p.key, { tendered: appendTenkeyDoubleZero(current) });
                        else updatePayment(p.key, { tendered: appendTenkeyDigit(current, k) });
                      }}
                    />
                  </div>
                )}
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
          {checkoutPending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              処理中…
            </>
          ) : (
            '会計を確定'
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={couponConfirmOpen}
        onClose={() => setCouponConfirmOpen(false)}
        title="既存の値引きを置き換えますか"
        message="このクーポンは他の値引きと併用できません。現在設定されている値引きを置き換えて適用します。"
        confirmLabel="置き換えて適用"
        destructive={false}
        onConfirm={() => runApplyCoupon(true)}
      />
    </Dialog>
  );
}
