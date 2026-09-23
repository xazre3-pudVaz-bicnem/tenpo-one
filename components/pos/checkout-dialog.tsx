'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2, ReceiptText, Trash2, Ticket, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { calcChange } from '@/lib/money';
import { METHOD_LABELS, METHOD_LABELS_EN } from '@/components/cash/labels';
import {
  discountAmountOf,
  percentDiscountAmount,
  type DiscountPreset,
  type PointBrand,
} from '@/lib/checkout-presets';
import { appendTenkeyDigit, appendTenkeyDoubleZero } from './tenkey';
import type { CheckoutPayment, ApplyCouponResult } from '@/app/app/pos/actions';
import type { TerminalPaymentState } from '@/app/app/pos/payment-actions';

const COUPON_PREFIX = 'クーポン: ';
const QUICK_CASH_AMOUNTS = [1000, 5000, 10000] as const;

/** 会計画面の左側に出す伝票の1行 */
export interface CheckoutLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CheckoutOrder {
  id: string;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  couponCode: string | null;
  total: number;
  /** 厨房へ未送信の品目数。会計と同時に厨房へ送られる旨を案内する */
  unsentCount?: number;
  /** 見出し用（T1 など）。無ければ伝票番号だけ出す */
  label?: string | null;
  guestCount?: number;
  orderNo?: number;
  /** 左に出す伝票の中身 */
  lines?: CheckoutLine[];
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

const BASE_METHODS: CheckoutPayment['method'][] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account', 'external', 'other'];
/** 支払方法のボタン（日本語の下に小さく英語）。スクロールせずに収まる高さにする */
const payMethodBtn =
  'flex h-[46px] flex-col items-center justify-center rounded-xl border px-1.5 text-center text-[14px] font-bold leading-tight transition-colors disabled:opacity-50';
const payMethodOn = 'border-iris bg-iris text-white';
const payMethodOff = 'border-line bg-white text-navy active:bg-lilac-soft';

/**
 * 外部の決済端末（stera 等）を操作してから確定する必要がある支払方法。
 * stera は TENPO ONE と電子連携しておらず「端末で決済 → TENPO ONE に金額入力」の手動2オペになる。
 * レポートの内訳を残すため実際の種別（クレジット/QR/電子マネー）を選ぶ運用のため、
 * 'external' だけでなくキャッシュレス種別全般で注意喚起する（未決済のまま確定する事故を防ぐ）。
 */
const TERMINAL_METHODS: CheckoutPayment['method'][] = ['credit', 'qr', 'emoney', 'external'];

/** 端末決済ポーリングの上限（60秒 ÷ 2秒間隔） */
const TERMINAL_POLL_INTERVAL_MS = 2000;
const TERMINAL_POLL_TIMEOUT_MS = 60000;

type TerminalStatus = 'idle' | 'sending' | 'polling' | 'timeout' | 'failed';

interface PaymentRow extends CheckoutPayment {
  key: string;
}

export function CheckoutDialog({
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
  clerkMissing = false,
  discountPresets = [],
  pointBrands = [],
}: {
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
  /** 担当者が未選択（会計には担当者が必要） */
  clerkMissing?: boolean;
  /** 値引きの選択肢（設定 > 決済・端末）。グルメサイトのクーポンなど */
  discountPresets?: DiscountPreset[];
  /** ポイントの選択肢（ホットペッパー・ぐるなび・食べログなど） */
  pointBrands?: PointBrand[];
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
  /** 値引きの入れ方（￥ か ％） */
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [percentInput, setPercentInput] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  /** 右側のタブ（支払 / 値引） */
  const [rightTab, setRightTab] = useState<'pay' | 'discount'>('pay');
  /** 会計が終わったあとに出す金額（お支払い・お預り・おつり） */
  const [done, setDone] = useState<{ total: number; tendered: number; change: number } | null>(null);
  const router = useRouter();
  /**
   * 支払いを複数に分けるモード。既定はOFF＝「タッチした支払方法だけ」を1つ表示する。
   * 現場から「クレジットをタッチすると行がどんどん積み上がる」と指摘されたため、
   * 積み上げ（現金+クレジットの併用など）は明示的にONにしたときだけの動作にした。
   */
  const [splitMode, setSplitMode] = useState(false);
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

  /** 値引き前の合計（％値引きはこの金額から計算する） */
  const baseTotal = order.total + order.discountTotal;

  const runDiscount = (amount: number, reason: string) => {
    if (amount > 0 && !reason.trim()) {
      toast('値引き理由を入力してください', 'error');
      return;
    }
    startDiscount(async () => {
      try {
        await setDiscountAction(order.id, amount, reason);
      } catch (e) {
        toast(e instanceof Error ? e.message : '値引きの適用に失敗しました', 'error');
      }
    });
  };

  const applyDiscount = () => {
    const amount =
      discountMode === 'percent'
        ? percentDiscountAmount(Number(percentInput) || 0, baseTotal)
        : Math.max(0, Number(discountInput) || 0);
    const reason =
      discountMode === 'percent' && !discountReasonInput.trim()
        ? `${Math.max(0, Math.min(100, Math.floor(Number(percentInput) || 0)))}%値引き`
        : discountReasonInput;
    runDiscount(amount, reason);
  };

  /**
   * 決めておいた値引きを押したとき。
   * 「金額はレジで入れる」（幹事様無料など）は名前を理由に入れて、金額の入力にうつる。
   */
  const applyPreset = (preset: DiscountPreset) => {
    setDiscountReasonInput(preset.name);
    if (preset.kind === 'manual') {
      setDiscountMode('amount');
      setDiscountInput('');
      toast(`${preset.name}：値引き額を入れてください`);
      return;
    }
    const amount = discountAmountOf(preset, baseTotal);
    setDiscountMode('amount');
    setDiscountInput(String(amount));
    runDiscount(amount, preset.name);
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

  const addPayment = (method: CheckoutPayment['method'], provider?: string | null) => {
    const cap = method === 'points' ? Math.min(maxPointsUsable, Math.max(0, remaining)) : Math.max(0, remaining);
    setPayments((rows) => [
      ...rows,
      { key: `${method}-${Date.now()}`, method, provider: provider ?? null, amount: cap, tendered: method === 'cash' ? cap : undefined },
    ]);
  };

  /**
   * 支払方法をタッチしたときの動作。
   * 既定（splitMode=false）は単一選択：タッチした支払方法だけが下に出る。
   * 別の方法をタッチすれば置き換わり、同じ方法をもう一度タッチすれば取り消す。
   * splitMode=true のときだけ従来どおり行を積み上げて併用払いにできる。
   */
  const selectPayment = (method: CheckoutPayment['method'], provider?: string | null) => {
    if (splitMode) {
      addPayment(method, provider);
      return;
    }
    const cap = method === 'points' ? Math.min(maxPointsUsable, order.total) : order.total;
    setPayments((rows) => {
      // 同じ方法をもう一度タッチしたら取り消す（選択トグル。サイトのポイントは同じサイトのとき）
      if (rows.length === 1 && rows[0].method === method && (rows[0].provider ?? null) === (provider ?? null)) return [];
      return [
        { key: `${method}-${Date.now()}`, method, provider: provider ?? null, amount: cap, tendered: method === 'cash' ? cap : undefined },
      ];
    });
  };

  // モードを切り替えたら入力済みの支払行は白紙に戻す（単一↔併用で金額の意味が変わるため）
  const toggleSplitMode = () => {
    setSplitMode((v) => !v);
    setPayments([]);
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
    !clerkMissing &&
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
        const cash = payments.find((p) => p.method === 'cash');
        setDone({
          total: order.total,
          tendered: cash?.tendered ?? 0,
          change: cash ? calcChange(cash.amount, cash.tendered ?? 0) : 0,
        });
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
    // 次に開いたとき前のお客様の支払い入力が残らないようにする
    setPayments([]);
    setSplitMode(false);
    setRightTab('pay');
    setDone(null);
    onClose();
  };

  /** テンキーなどが編集する対象の支払行（最後に選んだもの） */
  const activeRow = payments[payments.length - 1] ?? null;

  const setActiveValue = (next: number) => {
    if (!activeRow) return;
    if (activeRow.method === 'cash') {
      updatePayment(activeRow.key, { tendered: Math.max(0, next) });
    } else {
      const cap = activeRow.method === 'points' ? maxPointsUsable : Number.MAX_SAFE_INTEGER;
      updatePayment(activeRow.key, { amount: Math.max(0, Math.min(cap, next)) });
    }
  };
  const activeValue = activeRow ? (activeRow.method === 'cash' ? (activeRow.tendered ?? 0) : activeRow.amount) : 0;
  const cashRow = payments.find((p) => p.method === 'cash') ?? null;
  const tenderedTotal = cashRow ? (cashRow.tendered ?? 0) : 0;
  const changeTotal = cashRow ? calcChange(cashRow.amount, cashRow.tendered ?? 0) : 0;

  const keyBtn =
    'flex h-[58px] items-center justify-center rounded-xl border border-line bg-white text-2xl font-bold tabular-nums text-navy transition-colors active:bg-lilac disabled:opacity-40';
  const keySmall =
    'flex h-[58px] items-center justify-center rounded-xl border border-line bg-iris-soft text-base font-bold text-royal transition-colors active:bg-wisteria disabled:opacity-40';
  const sumRow = 'flex items-center justify-between py-2 text-[15px] text-ink-2';

  // 会計が終わったあとの画面（お支払い金額・お預り・おつり）
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
        <div className="w-full max-w-[620px] overflow-hidden rounded-[22px] bg-white shadow-xl">
          <div className="flex items-center gap-3 border-b border-line px-6 py-5">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-success-soft text-success">
              <Check className="h-6 w-6" />
            </span>
            <h2 className="text-[22px] font-extrabold text-navy">
              会計完了<span className="en-inline">Payment complete</span>
            </h2>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-baseline justify-between border-b border-line py-3 text-[17px] text-ink-2">
              <span>お支払い金額</span>
              <b className="text-2xl font-extrabold tabular-nums text-navy">{yen(done.total)}</b>
            </div>
            {done.tendered > 0 && (
              <div className="flex items-baseline justify-between border-b border-line py-3 text-[17px] text-ink-2">
                <span>お預かり金額</span>
                <b className="text-2xl font-extrabold tabular-nums text-navy">{yen(done.tendered)}</b>
              </div>
            )}
            <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-iris-soft px-5 py-4">
              <span className="text-[19px] font-extrabold text-royal">おつり</span>
              <b className="text-[44px] font-extrabold leading-none tabular-nums text-royal">{yen(done.change)}</b>
            </div>
          </div>
          <p className="px-6 pb-2 text-center text-xs text-ink-3">
            レシートは自動で印字されます（レシート機の「自動印刷」がONのとき）
          </p>
          <div className="grid grid-cols-2 gap-3 px-6 pb-6">
            <Button variant="secondary" size="pos" className="h-[62px]" onClick={() => router.push(`/app/pos/receipt/${order.id}`)}>
              <ReceiptText className="h-5 w-5" />
              レシート・領収書
            </Button>
            <Button variant="secondary" size="pos" className="h-[62px]" onClick={() => router.push('/app/floor')}>
              テーブル一覧へ
            </Button>
            <Button size="pos" className="col-span-2 h-[62px] text-[18px]" onClick={() => router.push('/app/pos')}>
              連続会計（次の伝票へ）
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-lilac">
      {/* 上部バー */}
      <div className="flex h-[58px] shrink-0 items-center bg-plum px-3 text-white">
        <button
          type="button"
          onClick={handleDialogClose}
          className="inline-flex items-center gap-1 rounded-lg bg-white/12 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
          伝票へ戻る
        </button>
        <span className="mx-auto text-[17px] font-bold tracking-[0.12em]">
          お会計<span className="ml-2 text-[11px] font-semibold tracking-normal opacity-70">Checkout</span>
        </span>
        <span className="w-[112px]" />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[1fr_1fr_390px] lg:overflow-hidden">
        {/* 左: 伝票 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h3 className="text-[15px] font-bold text-navy">
              伝票<span className="en-inline">Slip</span>
            </h3>
            {order.orderNo != null && <span className="text-xs text-ink-3">#{order.orderNo}</span>}
            <span className="ml-auto flex items-center gap-2">
              {order.label && <span className="text-xl font-extrabold text-royal">{order.label}</span>}
              {order.guestCount != null && (
                <span className="rounded-full bg-iris-soft px-3 py-1 text-xs font-bold text-royal">{order.guestCount}名</span>
              )}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {(order.lines ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-3">品目がありません</p>
            ) : (
              <ul className="divide-y divide-line">
                {(order.lines ?? []).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-navy">{l.name}</span>
                    <span className="w-12 text-right text-sm text-ink-2 tabular-nums">{l.quantity}</span>
                    <span className="w-[88px] text-right text-[15px] font-bold tabular-nums text-navy">{yen(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(order.unsentCount ?? 0) > 0 && (
            <p className="border-t border-line bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              厨房へ未送信の品目が {order.unsentCount} 品あります。会計を確定すると同時に厨房へ送信されます。
            </p>
          )}
        </section>

        {/* 中: 金額 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[15px] font-bold text-navy">
              金額<span className="en-inline">Amount</span>
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <div className={sumRow}>
              <span>小計</span>
              <b className="font-bold tabular-nums text-ink">{yen(order.subtotal)}</b>
            </div>
            {order.serviceCharge > 0 && (
              <div className={cn(sumRow, 'pl-3 text-[13px] text-ink-3')}>
                <span>サービス料</span>
                <b className="tabular-nums">{yen(order.serviceCharge)}</b>
              </div>
            )}
            <div className={cn(sumRow, order.discountTotal > 0 && 'text-warning')}>
              <span>値引き・クーポン{order.couponCode ? `（${order.couponCode}）` : ''}</span>
              <b className="font-bold tabular-nums">{order.discountTotal > 0 ? `-${yen(order.discountTotal)}` : yen(0)}</b>
            </div>
            <div className="my-2 border-t border-dashed border-line" />
            <div className="flex items-baseline justify-between py-2">
              <span className="text-base font-bold text-navy">お支払い金額</span>
              <b className="text-[34px] font-extrabold leading-none tabular-nums text-royal">{yen(order.total)}</b>
            </div>
            <div className={cn(sumRow, 'pl-3 text-[13px] text-ink-3')}>
              <span>うち消費税</span>
              <b className="tabular-nums">{yen(order.taxTotal)}</b>
            </div>
            <div className="my-2 border-t border-dashed border-line" />
            <div className={sumRow}>
              <span>お預り</span>
              <b className="font-bold tabular-nums text-ink">{yen(tenderedTotal)}</b>
            </div>
            <div className="flex items-baseline justify-between py-1.5">
              <span className="text-[15px] font-bold text-ink-2">残額</span>
              <b className={cn('text-2xl font-extrabold tabular-nums', remaining === 0 ? 'text-success' : 'text-warning')}>
                {yen(remaining)}
              </b>
            </div>
            <div className={sumRow}>
              <span>おつり</span>
              <b className="font-bold tabular-nums text-ink">{yen(changeTotal)}</b>
            </div>

            {payments.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                {payments.map((p) => (
                  <div key={p.key} className="flex items-center gap-2 rounded-xl bg-lilac-soft px-3 py-2">
                    <Badge tone="navy" className="shrink-0">
                      {METHOD_LABELS[p.method]}
                    </Badge>
                    <span className="ml-auto text-lg font-bold tabular-nums text-navy">{yen(p.amount)}</span>
                    <button
                      type="button"
                      aria-label="削除"
                      onClick={() => removePayment(p.key)}
                      className="rounded p-1 text-ink-3 hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-line p-3">
            {clerkMissing && (
              <p className="mb-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
                担当者を選んでください（伝票へ戻って担当を選ぶと会計できます）
              </p>
            )}
            <Button
              size="pos"
              className="h-[56px] w-full text-[18px]"
              disabled={!canConfirm || checkoutPending}
              onClick={handleConfirm}
            >
              {checkoutPending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  処理中…
                </>
              ) : (
                '会計する'
              )}
            </Button>
          </div>
        </section>

        {/* 右: 支払・値引 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[15px] font-bold text-navy">
              支払<span className="en-inline">Payment</span>
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex gap-1 rounded-xl bg-lilac p-1">
              <button
                type="button"
                onClick={() => setRightTab('pay')}
                className={cn(
                  'flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors',
                  rightTab === 'pay' ? 'bg-white text-royal shadow-sm' : 'text-ink-2'
                )}
              >
                支払<span className="block text-[10px] font-semibold opacity-70">Payment</span>
              </button>
              <button
                type="button"
                disabled={!canDiscount}
                onClick={() => setRightTab('discount')}
                className={cn(
                  'flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors disabled:opacity-40',
                  rightTab === 'discount' ? 'bg-white text-royal shadow-sm' : 'text-ink-2'
                )}
              >
                値引<span className="block text-[10px] font-semibold opacity-70">Discount</span>
              </button>
            </div>

            {rightTab === 'pay' ? (
              <>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-ink-3">支払方法 / Payment method</span>
                  <button
                    type="button"
                    onClick={toggleSplitMode}
                    disabled={terminalBlocking}
                    aria-pressed={splitMode}
                    className={cn(
                      'flex shrink-0 flex-col items-center rounded-full px-3 py-1 text-[11px] font-bold leading-tight transition-colors disabled:opacity-50',
                      splitMode ? 'bg-iris text-white' : 'bg-lilac text-ink-2'
                    )}
                  >
                    {splitMode ? '分けて払う：ON' : '分けて払う'}
                    <span className={cn('text-[9px] font-semibold', splitMode ? 'text-white/80' : 'text-ink-3')}>
                      Split payment
                    </span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {BASE_METHODS.map((m) => {
                    const selected = payments.some((p) => p.method === m);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={terminalBlocking}
                        aria-pressed={selected}
                        onClick={() => selectPayment(m)}
                        className={cn(payMethodBtn, selected ? payMethodOn : payMethodOff)}
                      >
                        <span className="block">{METHOD_LABELS[m]}</span>
                        <span className={cn('block text-[10px] font-semibold', selected ? 'text-white/80' : 'text-ink-3')}>
                          {METHOD_LABELS_EN[m]}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={terminalBlocking || !pointsAvailability.available}
                    aria-pressed={payments.some((p) => p.method === 'points')}
                    title={pointsAvailability.available ? `残高 ${pointsAvailability.balance}pt` : '顧客紐付け・会員機能有効・残高が必要です'}
                    onClick={() => selectPayment('points')}
                    className={cn(
                      payMethodBtn,
                      payments.some((p) => p.method === 'points') ? payMethodOn : payMethodOff,
                      'disabled:opacity-40'
                    )}
                  >
                    <span className="block">自社ポイント</span>
                    <span
                      className={cn(
                        'block text-[10px] font-semibold',
                        payments.some((p) => p.method === 'points') ? 'text-white/80' : 'text-ink-3'
                      )}
                    >
                      Our points
                    </span>
                  </button>
                </div>

                {/* グルメサイトのポイント（ホットペッパー・ぐるなび・食べログなど。設定 > 決済・端末 で足せる） */}
                {pointBrands.length > 0 && (
                  <div className="mt-1.5">
                    <p className="mb-1 text-[11px] font-bold text-ink-3">サイトのポイント / Site points</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {pointBrands.map((b) => {
                        const selected = payments.some((p) => p.method === 'site_points' && p.provider === b.key);
                        return (
                          <button
                            key={b.key}
                            type="button"
                            disabled={terminalBlocking}
                            aria-pressed={selected}
                            onClick={() => selectPayment('site_points', b.key)}
                            className={cn(
                              'flex h-[40px] items-center justify-center rounded-xl border px-1.5 text-center text-[12.5px] font-bold leading-tight transition-colors disabled:opacity-50',
                              selected ? 'border-iris bg-iris text-white' : 'border-line bg-white text-navy active:bg-lilac-soft'
                            )}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {payments.some((p) => TERMINAL_METHODS.includes(p.method)) && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    決済端末（stera 等）で決済してから「会計する」を押してください。
                  </p>
                )}

                {/* 金額表示とテンキー（選んだ支払方法の金額・現金は預り金を入力する） */}
                <div className="mt-3 rounded-xl bg-plum px-4 py-3 text-right text-[34px] font-extrabold tabular-nums text-white">
                  {activeRow ? activeValue.toLocaleString() : 0}
                </div>
                <p className="mt-1 text-right text-[11px] text-ink-3">
                  {activeRow ? (activeRow.method === 'cash' ? '預り金を入力' : `${METHOD_LABELS[activeRow.method]}の金額`) : '支払方法を選んでください'}
                </p>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {QUICK_CASH_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      disabled={!activeRow}
                      onClick={() => setActiveValue(activeValue + amt)}
                      className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-[15px] font-bold tabular-nums text-navy active:bg-lilac disabled:opacity-40"
                    >
                      {amt.toLocaleString()}
                    </button>
                  ))}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" disabled={!activeRow} onClick={() => setActiveValue(0)} className={cn(keySmall, 'text-danger')}>
                    C
                  </button>
                  <button
                    type="button"
                    disabled={!activeRow}
                    onClick={() => setActiveValue(activeRow?.method === 'cash' ? (activeRow?.amount ?? 0) : Math.max(0, remaining) + (activeRow?.amount ?? 0))}
                    className={keySmall}
                  >
                    ちょうど
                  </button>
                  <button
                    type="button"
                    disabled={!activeRow}
                    onClick={() => setActiveValue(Math.floor(activeValue / 10))}
                    className={keySmall}
                  >
                    訂正
                  </button>
                  {(['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const).map((k) => (
                    <button key={k} type="button" disabled={!activeRow} onClick={() => setActiveValue(appendTenkeyDigit(activeValue, k))} className={keyBtn}>
                      {k}
                    </button>
                  ))}
                  <button type="button" disabled={!activeRow} onClick={() => setActiveValue(appendTenkeyDigit(activeValue, '0'))} className={keyBtn}>
                    0
                  </button>
                  <button type="button" disabled={!activeRow} onClick={() => setActiveValue(appendTenkeyDoubleZero(activeValue))} className={keyBtn}>
                    00
                  </button>
                  <button
                    type="button"
                    disabled={!canConfirm || checkoutPending}
                    onClick={handleConfirm}
                    className="flex h-[58px] items-center justify-center rounded-xl bg-iris text-lg font-bold text-white active:bg-iris-deep disabled:opacity-40"
                  >
                    決定
                  </button>
                </div>

                {paymentAvailability.configured && terminalReaders.length > 0 && (
                  <div className="mt-3 rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold text-navy">カード端末で決済</p>
                      {paymentAvailability.testMode && <Badge tone="warning">テスト</Badge>}
                    </div>
                    {terminalStatus === 'idle' ? (
                      <div className="space-y-2">
                        {terminalReaders.length > 1 && (
                          <Select id="terminal-reader" value={selectedReaderId} onChange={(e) => setSelectedReaderId(e.target.value)}>
                            {terminalReaders.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                                {r.isSimulated ? '（シミュレーション）' : ''}
                              </option>
                            ))}
                          </Select>
                        )}
                        {terminalError && <p className="text-xs text-danger">{terminalError}</p>}
                        <Button variant="navy" size="md" className="w-full" disabled={!selectedReaderId || terminalActionPending} onClick={handleStartTerminal}>
                          端末へ送信（{yen(order.total)}）
                        </Button>
                      </div>
                    ) : terminalStatus === 'sending' || terminalStatus === 'polling' ? (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <Loader2 className="h-5 w-5 animate-spin text-iris" />
                        <p className="text-xs text-ink-2">{terminalStatus === 'sending' ? '端末へ送信しています…' : 'お客様の決済をお待ちしています…'}</p>
                        <Button variant="secondary" size="sm" onClick={handleCancelTerminal} disabled={terminalActionPending}>
                          キャンセル
                        </Button>
                      </div>
                    ) : terminalStatus === 'timeout' ? (
                      <div className="space-y-2 text-center">
                        <p className="text-xs text-warning">状態の確認がタイムアウトしました。決済は継続している場合があります。</p>
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
                      <div className="space-y-2 text-center">
                        <p className="text-xs text-danger">{terminalError ?? '決済に失敗しました'}</p>
                        <Button variant="secondary" size="sm" onClick={handleCancelTerminal} disabled={terminalActionPending}>
                          閉じて他の支払方法を選ぶ
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-1 rounded-xl bg-lilac p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setCouponMode(false)}
                    className={cn('flex-1 rounded-lg py-2 font-bold', !couponMode ? 'bg-white text-royal shadow-sm' : 'text-ink-2')}
                  >
                    値引き
                  </button>
                  <button
                    type="button"
                    onClick={() => setCouponMode(true)}
                    className={cn('flex-1 rounded-lg py-2 font-bold', couponMode ? 'bg-white text-royal shadow-sm' : 'text-ink-2')}
                  >
                    クーポン
                  </button>
                </div>
                {couponMode ? (
                  <>
                    <div>
                      <Label htmlFor="coupon-code">クーポンコード</Label>
                      <Input id="coupon-code" value={couponCodeInput} onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())} placeholder="例: WELCOME500" />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" className="flex-1" onClick={() => runApplyCoupon(false)} disabled={couponPending}>
                        <Ticket className="h-4 w-4" />
                        適用
                      </Button>
                      {order.couponCode && (
                        <Button variant="secondary" onClick={handleClearCoupon} disabled={couponPending}>
                          <XIcon className="h-4 w-4" />
                          解除
                        </Button>
                      )}
                    </div>
                    {order.couponCode && <p className="text-xs text-ink-2">適用中: {order.couponCode}</p>}
                  </>
                ) : (
                  <>
                    {/* グルメサイトのクーポンなど、決めておいた値引き（設定 > 決済・端末 で足せる） */}
                    {discountPresets.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-bold text-ink-3">決まった値引き / Presets</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {discountPresets.map((d) => (
                            <button
                              key={d.key}
                              type="button"
                              disabled={discountPending}
                              onClick={() => applyPreset(d)}
                              className="flex h-[44px] flex-col items-center justify-center rounded-xl border border-line bg-white px-1.5 text-center text-[13px] font-bold leading-tight text-navy active:bg-lilac-soft disabled:opacity-50"
                            >
                              {d.name}
                              {d.kind !== 'manual' && (
                                <span className="text-[10px] font-semibold text-ink-3">
                                  {d.kind === 'percent' ? `${d.value}%` : yen(d.value)}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ％で引くか、円で引くか */}
                    <div className="flex gap-1 rounded-xl bg-lilac p-1 text-xs">
                      {(['amount', 'percent'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDiscountMode(m)}
                          className={cn(
                            'flex-1 rounded-lg py-2 font-bold',
                            discountMode === m ? 'bg-white text-royal shadow-sm' : 'text-ink-2'
                          )}
                        >
                          {m === 'amount' ? '￥値引き' : '％値引き'}
                        </button>
                      ))}
                    </div>

                    {discountMode === 'percent' ? (
                      <div>
                        <Label htmlFor="discount-percent">値引き率（％）</Label>
                        <Input
                          id="discount-percent"
                          type="number"
                          min={0}
                          max={100}
                          value={percentInput}
                          onChange={(e) => setPercentInput(e.target.value)}
                        />
                        <p className="mt-1 text-[11px] text-ink-3">
                          引く金額 {yen(percentDiscountAmount(Number(percentInput) || 0, baseTotal))}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <Label htmlFor="discount-amount">値引き額</Label>
                        <Input id="discount-amount" type="number" min={0} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
                      </div>
                    )}
                    <div>
                      <Label htmlFor="discount-reason">理由</Label>
                      <Input id="discount-reason" value={discountReasonInput} onChange={(e) => setDiscountReasonInput(e.target.value)} placeholder="端数調整・サービス等" />
                    </div>
                    <Button variant="secondary" className="w-full" onClick={applyDiscount} disabled={discountPending}>
                      {discountPending ? '処理中…' : '値引きを適用'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
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
    </div>
  );
}
