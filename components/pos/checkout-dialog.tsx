'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Home,
  ChevronLeft,
  ChevronRight,
  Delete,
  Loader2,
  Trash2,
  Ticket,
  X as XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { calcChange } from '@/lib/money';
import { METHOD_LABELS, METHOD_LABELS_EN } from '@/components/cash/labels';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { enqueueReceiptPrint } from '@/app/app/pos/print-actions';
import type { ClerkOption } from './clerk-selector';
import { useClerkGate } from './clerk-gate';
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

/**
 * 会計画面に出す支払方法（2026-09-24 要望で 商品券・掛売 は出さない）。
 * 過去の伝票には残っているので、表示のラベル（METHOD_LABELS）は消していない。
 */
const BASE_METHODS: CheckoutPayment['method'][] = ['credit', 'qr', 'emoney', 'external', 'other'];
/** 支払方法のボタン（日本語の下に小さく英語）。スクロールせずに収まる高さにする */
const payMethodBtn =
  'flex h-[46px] flex-col items-center justify-center rounded-xl border px-1.5 text-center text-[14px] font-bold leading-tight transition-colors disabled:opacity-50';
const payMethodOn = 'border-iris bg-iris text-white';
const payMethodOff = 'border-line bg-white text-navy active:bg-lilac-soft';
/** どのポイントかを選ぶボタン（ポイントを押したあとに出る） */
const pointBrandBtn =
  'flex h-[40px] items-center justify-center rounded-xl border px-1.5 text-center text-[12.5px] font-bold leading-tight transition-colors disabled:opacity-40';
const pointBrandOn = 'border-iris bg-iris text-white';
const pointBrandOff = 'border-line bg-white text-navy active:bg-lilac-soft';

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
  clerks = [],
  currentClerkId = null,
  discountPresets = [],
  pointBrands = [],
  methodBrands = {},
  splitOrderAction,
}: {
  onClose: () => void;
  order: CheckoutOrder;
  canDiscount: boolean;
  discountReason: string | null;
  setDiscountAction: (orderId: string, discountTotal: number, reason: string) => Promise<void>;
  applyCouponAction: (orderId: string, code: string, force?: boolean) => Promise<ApplyCouponResult>;
  clearCouponAction: (orderId: string) => Promise<void>;
  onCheckout: (payments: CheckoutPayment[], paymentMemo?: string) => Promise<void>;
  terminalReaders: PosTerminalReader[];
  paymentAvailability: PosPaymentAvailability;
  pointsAvailability: PointsAvailability;
  startTerminalPaymentAction: (orderId: string, readerId: string) => Promise<TerminalPaymentState>;
  checkTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  cancelTerminalPaymentAction: (localIntentId: string) => Promise<TerminalPaymentState>;
  onTerminalPaymentFinalized: () => void;
  /** 店舗のPOS担当者。会計画面でそのまま選べる（2026-09-25 要望） */
  clerks?: ClerkOption[];
  /** いまの伝票の担当者 */
  currentClerkId?: string | null;
  /** 値引きの選択肢（設定 > 決済・端末）。グルメサイトのクーポンなど */
  discountPresets?: DiscountPreset[];
  /** ポイントの選択肢（ホットペッパー・ぐるなび・食べログなど） */
  pointBrands?: PointBrand[];
  /** 支払方法ごとの内訳（クレジット→VISA…、QR→PayPay…） */
  methodBrands?: Record<string, PointBrand[]>;
  /** 別々会計：選んだ品目を別の伝票に移す（移した伝票をそのまま会計する） */
  splitOrderAction?: (
    orderId: string,
    moves: { orderItemId: string; quantity: number }[]
  ) => Promise<{ newOrderId: string }>;
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
  /** 押した支払方法（内訳＝VISA・PayPay・ホットペッパー等を選ぶ列を出す） */
  const [openMethod, setOpenMethod] = useState<string | null>(null);
  /**
   * 別々会計（2026-09-24 要望）。
   * 金額を人数で割るのではなく、「ランチのセットごと」＝食べた品目ごとに分けて払う。
   * 選んだ品目を別の伝票へ移し（伝票分割）、その伝票をそのまま会計する。
   * 値は 品目ID → この人が持つ数量。
   */
  const [splitPick, setSplitPick] = useState<Record<string, number> | null>(null);
  const [splitPending, startSplit] = useTransition();
  /** 値引きの入れ方（￥ か ％） */
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [percentInput, setPercentInput] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  /** 右側のタブ（支払 / 値引） */
  const [rightTab, setRightTab] = useState<'pay' | 'discount'>('pay');
  /** 会計が終わったあとに出す金額（お支払い・お預り・おつり） */
  const [done, setDone] = useState<{ total: number; tendered: number; change: number } | null>(null);
  /** 支払メモ（レジ締めや取引履歴で読む。2026-09-25 店舗要望） */
  const [payMemo, setPayMemo] = useState('');
  /** 別々会計の「品目ごと／金額ごと」を選ぶ小さなメニューを開いているか */
  const [splitOpen, setSplitOpen] = useState(false);
  /** 会計完了のあとに出す「レシート／領収書」。領収書は宛名・但し書きを入れてから印字する */
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [invoicePurpose, setInvoicePurpose] = useState('お品代として');
  const [printPending, startPrint] = useTransition();
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

  /** 担当者（会計画面でも選べる。選ばないと会計できない） */
  const [clerkId, setClerkId] = useState(currentClerkId ?? '');
  const [, startClerk] = useTransition();
  const clerkGate = useClerkGate();
  const gateAppliedRef = useRef(false);

  // レジは入口で担当者を選んでいるので、会計画面でも選び直さなくていいようにそれを入れる（2026-09-24 店舗要望）
  const gateClerkId = clerkGate?.clerk?.id ?? null;
  useEffect(() => {
    if (!gateClerkId || clerkId || gateAppliedRef.current) return;
    if (!clerks.some((c) => c.id === gateClerkId)) return;
    gateAppliedRef.current = true;
    startClerk(async () => {
      const res = await setOrderClerk(order.id, gateClerkId);
      if (res.ok) setClerkId(gateClerkId);
      else gateAppliedRef.current = false;
    });
  }, [gateClerkId, clerkId, clerks, order.id]);
  // 担当者は卓をタップする時に選んでいるので、会計画面では選ばせない（2026-09-25 店舗要望）。
  // 伝票に担当者が入っていないときだけ、会計を止めて伝票画面で選んでもらう
  const clerkMissing = clerks.length > 0 && !clerkId;

  /** ポイント（自社・サイト）で払う指定があるか */
  const pointsSelected = payments.some((p) => p.method === 'points' || p.method === 'site_points');

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
    const left = Math.max(0, remaining);
    const cap = method === 'points' ? Math.min(maxPointsUsable, left) : left;
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
    setPayments((rows) => {
      const same = (r: PaymentRow) => r.method === method && (r.provider ?? null) === (provider ?? null);
      // 同じ方法をもう一度タッチしたら取り消す（選択トグル。内訳つきは同じ内訳のとき）
      if (rows.some(same)) return rows.filter((r) => !same(r));
      // すでに入れた支払で足りていなければ、残りを足す
      // （例：ポイントで400円払って、残りを現金やカードで払う。2026-09-24 要望）
      const paid = rows.reduce((sum, r) => sum + r.amount, 0);
      const left = Math.max(0, order.total - paid);
      const base = rows.length > 0 && left > 0 ? left : order.total;
      const cap = method === 'points' ? Math.min(maxPointsUsable, base) : base;
      const row: PaymentRow = {
        key: `${method}-${Date.now()}`,
        method,
        provider: provider ?? null,
        amount: cap,
        tendered: method === 'cash' ? cap : undefined,
      };
      return rows.length > 0 && left > 0 ? [...rows, row] : [row];
    });
  };

  // モードを切り替えたら入力済みの支払行は白紙に戻す（単一↔併用で金額の意味が変わるため）
  const toggleSplitMode = () => {
    setSplitMode((v) => !v);
    setPayments([]);
  };

  /**
   * 別々会計（2026-09-24 要望）。
   * 例：4人でランチのセットをそれぞれ頼んだ → 自分が食べた分だけ払う。
   * この人の品目を選んで「この分を会計」を押すと、その品目だけ別の伝票になり、
   * そのまま会計画面が開く。残りは元の伝票に残るので、次の人も同じように会計できる。
   */
  const splitLines = order.lines ?? [];
  const splitTotal = splitPick
    ? splitLines.reduce((sum, l) => sum + (splitPick[l.id] ?? 0) * l.unitPrice, 0)
    : 0;
  const splitCount = splitPick ? Object.values(splitPick).reduce((a, b) => a + b, 0) : 0;
  /** 全部を選んだら分割にならない（元の伝票が空になる） */
  const splitIsAll = splitLines.every((l) => (splitPick?.[l.id] ?? 0) >= l.quantity);

  const pickSplit = (lineId: string, max: number, delta: number) =>
    setSplitPick((cur) => {
      const now = { ...(cur ?? {}) };
      const next = Math.min(max, Math.max(0, (now[lineId] ?? 0) + delta));
      if (next === 0) delete now[lineId];
      else now[lineId] = next;
      return now;
    });

  const confirmSplit = () => {
    if (!splitOrderAction || splitCount === 0 || splitIsAll) return;
    const moves = Object.entries(splitPick ?? {}).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    startSplit(async () => {
      try {
        const res = await splitOrderAction(order.id, moves);
        setSplitPick(null);
        router.push(`/app/pos?order=${res.newOrderId}&checkout=1`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '伝票を分けられませんでした', 'error');
      }
    });
  };

  const updatePayment = (key: string, patch: Partial<PaymentRow>) => {
    setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removePayment = (key: string) => {
    setPayments((rows) => rows.filter((r) => r.key !== key));
  };

  /**
   * 合計0円（値引き・クーポンで満額オフ、まかない・招待など）はそのまま会計できる。
   * 支払方法を押しても押さなくてもよい（押すと0円の行ができるが、送るときに落とす）。
   * 0円以外はこれまで通り「支払行が1件以上」かつ「各行の金額>0」。
   */
  const canConfirm =
    !clerkMissing && !terminalBlocking && paid === order.total &&
    (order.total === 0 ? true : payments.length > 0 && payments.every((p) => p.amount > 0));

  const handleConfirm = () => {
    // disabled属性の反映を待たず、同一フレーム内の連打でも1回しか送信しない
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
    startCheckout(async () => {
      try {
        await onCheckout(
          // 0円の行は送らない（0円会計のときに空の支払として確定させるため）
          payments
            .filter((p) => p.amount > 0)
            .map((p) => ({
              method: p.method,
              amount: p.amount,
              tendered: p.method === 'cash' ? p.tendered : undefined,
              provider: p.provider ?? null,
            })),
          payMemo.trim() || undefined
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
    setSplitPick(null);
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
    'flex h-[52px] items-center justify-center rounded-xl border border-line bg-white text-2xl font-bold tabular-nums text-navy transition-colors active:bg-lilac disabled:opacity-40';
  // 文字のキー（C・ちょうど・訂正）は日本語の下に小さく英語
  const keySmall =
    'flex h-[52px] flex-col items-center justify-center rounded-xl border border-line bg-iris-soft text-base font-bold leading-tight text-royal transition-colors active:bg-wisteria disabled:opacity-40';
  const keySmallEn = 'text-[10px] font-semibold text-royal/70';
  const sumRow = 'flex items-center justify-between py-2 text-[15px] text-ink-2';

  // 会計が終わったあとの画面（お支払い金額・お預り・おつり）
  /** 会計完了の画面から、レシート／領収書をレシート機へ出す */
  const printSlip = (jobType: 'receipt' | 'ryoshusho') =>
    startPrint(async () => {
      const res = await enqueueReceiptPrint(order.id, {
        jobType,
        ...(jobType === 'ryoshusho'
          ? { recipientName: recipientName.trim() || null, purpose: invoicePurpose.trim() || null }
          : {}),
      });
      if (!res.ok) {
        toast(res.error ?? '送信に失敗しました', 'error');
        return;
      }
      toast(jobType === 'ryoshusho' ? '領収書をプリンタへ送りました' : 'レシートをプリンタへ送りました');
      if (jobType === 'ryoshusho') setInvoiceOpen(false);
    });

  /** 伝票分割の画面（見本のレジと同じ：左＝元の伝票、右＝分ける伝票。2026-09-25 店舗要望） */
  const splitScreen = splitPick != null && (
    <div className="fixed inset-0 z-[70] flex flex-col bg-lilac-soft">
      <header className="flex items-center justify-between gap-3 bg-plum px-4 py-3 text-white">
        <button
          type="button"
          onClick={() => setSplitPick(null)}
          className="inline-flex min-h-10 items-center gap-1 text-[15px] font-bold"
        >
          <ChevronLeft className="h-5 w-5" />
          レジ会計
        </button>
        <b className="text-[17px]">伝票分割 / Split by item</b>
        <span className="w-[92px]" aria-hidden />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_72px_1fr] gap-3 p-4">
        {/* 左：元の伝票に残る分 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
          <p className="border-b border-line px-4 py-2.5 text-[15px] font-bold text-royal">
            {order.label ?? `伝票 #${order.orderNo ?? ''}`}
            <span className="ml-2 text-[11px] font-semibold text-ink-3">元の伝票 / Stays</span>
          </p>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {splitLines.map((l) => {
              const left = l.quantity - (splitPick[l.id] ?? 0);
              if (left <= 0) return null;
              return (
                <li key={l.id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-navy">{l.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">×{left}</span>
                  <b className="w-[84px] shrink-0 text-right text-[14px] font-bold text-navy tabular-nums">
                    {yen(l.unitPrice * left)}
                  </b>
                  <button
                    type="button"
                    aria-label={`${l.name}を分ける伝票へ`}
                    onClick={() => pickSplit(l.id, l.quantity, 1)}
                    className="tap3d grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-royal"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="flex items-baseline justify-between border-t border-line px-4 py-3 text-[15px]">
            <span className="font-bold text-ink-2">合計金額</span>
            <b className="text-xl font-extrabold text-navy tabular-nums">{yen(order.total - splitTotal)}</b>
          </p>
        </section>

        <div className="flex flex-col items-center justify-center gap-4 text-ink-3">
          <ChevronRight className="h-9 w-9" aria-hidden />
          <ChevronLeft className="h-9 w-9" aria-hidden />
        </div>

        {/* 右：分けて先に会計する分 */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-iris bg-white">
          <p className="border-b border-line px-4 py-2.5 text-[15px] font-bold text-royal">
            分ける伝票<span className="ml-2 text-[11px] font-semibold text-ink-3">この分を先に会計 / Pay now</span>
          </p>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {splitLines.map((l) => {
              const picked = splitPick[l.id] ?? 0;
              if (picked <= 0) return null;
              return (
                <li key={l.id} className="flex items-center gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    aria-label={`${l.name}を元の伝票へ戻す`}
                    onClick={() => pickSplit(l.id, l.quantity, -1)}
                    className="tap3d grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-royal"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-navy">{l.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">×{picked}</span>
                  <b className="w-[84px] shrink-0 text-right text-[14px] font-bold text-navy tabular-nums">
                    {yen(l.unitPrice * picked)}
                  </b>
                </li>
              );
            })}
            {splitCount === 0 && (
              <li className="px-4 py-10 text-center text-[13px] text-ink-3">
                左の伝票から「›」で品を移してください
              </li>
            )}
          </ul>
          <p className="flex items-baseline justify-between border-t border-line px-4 py-3 text-[15px]">
            <span className="font-bold text-ink-2">合計金額</span>
            <b className="text-xl font-extrabold text-royal tabular-nums">{yen(splitTotal)}</b>
          </p>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3 px-4 pb-4">
        {splitIsAll && splitCount > 0 && (
          <span className="text-[13px] font-bold text-warning">
            全部を移すと分かれません。1つは元の伝票に残してください
          </span>
        )}
        <Button
          size="pos"
          className="h-[56px] w-[220px] text-[18px]"
          disabled={splitPending || splitCount === 0 || splitIsAll}
          onClick={confirmSplit}
        >
          {splitPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          この分を会計
        </Button>
      </div>
    </div>
  );

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
        <div className="w-full max-w-[560px] overflow-hidden rounded-[22px] bg-white shadow-xl">
          {/* 見本のレジと同じ：おつりを大きく、下に金額、ボタンは2段（2026-09-25 店舗要望） */}
          <div className="flex items-center justify-center gap-2 px-6 pt-6">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-success text-white">
              <Check className="h-5 w-5" />
            </span>
            <h2 className="text-[19px] font-bold text-navy">会計が完了しました</h2>
          </div>

          <div className="px-6 pt-4 pb-2 text-center">
            <p className="text-[15px] font-bold text-ink-2">おつり</p>
            <p className="text-[52px] leading-none font-extrabold tabular-nums text-navy">{yen(done.change)}</p>
          </div>

          <div className="mx-6 border-t border-line">
            <div className="flex items-baseline justify-between border-b border-line py-3 text-[15px] text-ink-2">
              <span>お支払い金額</span>
              <b className="text-[17px] font-bold tabular-nums text-navy">{yen(done.total)}</b>
            </div>
            <div className="flex items-baseline justify-between py-3 text-[15px] text-ink-2">
              <span>お預かり金額</span>
              <b className="text-[17px] font-bold tabular-nums text-navy">{yen(done.tendered)}</b>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 px-6 pt-3">
            <Button variant="secondary" size="pos" className="h-[52px] text-[15px]" onClick={() => router.push('/app/menu')}>
              <Home className="h-[18px] w-[18px]" />
              メニュー
            </Button>
            <Button
              variant="secondary"
              size="pos"
              className="h-[52px] text-[15px]"
              disabled={printPending}
              onClick={() => printSlip('receipt')}
            >
              {printPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              レシート発行
            </Button>
            <Button
              variant="secondary"
              size="pos"
              className="h-[52px] text-[15px]"
              disabled={printPending}
              onClick={() => setInvoiceOpen(true)}
            >
              領収書発行
            </Button>
          </div>

          <div className="mx-6 mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 pb-6">
            <Button
              variant="secondary"
              size="pos"
              className="h-[56px] text-[16px]"
              onClick={() => router.push(`/app/pos/receipt/${order.id}`)}
            >
              伝票明細
            </Button>
            <Button size="pos" className="h-[56px] text-[17px]" onClick={() => router.push('/app/pos')}>
              続けて会計
            </Button>
          </div>

          {invoiceOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-navy/50" aria-hidden onClick={() => setInvoiceOpen(false)} />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="領収書"
                className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
              >
                <p className="text-[17px] font-bold text-navy">
                  領収書<span className="ml-2 text-[11px] font-normal text-ink-3">Invoice</span>
                </p>
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="inv-name">宛名 / Name（空欄なら「上様」）</Label>
                    <Input
                      id="inv-name"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="上様"
                      className="h-12"
                    />
                  </div>
                  <div>
                    <Label htmlFor="inv-purpose">但し書き / For</Label>
                    <Input
                      id="inv-purpose"
                      value={invoicePurpose}
                      onChange={(e) => setInvoicePurpose(e.target.value)}
                      placeholder="お品代として"
                      className="h-12"
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Button variant="secondary" className="h-12" onClick={() => setInvoiceOpen(false)}>
                    やめる / Cancel
                  </Button>
                  <Button className="h-12" disabled={printPending} onClick={() => printSlip('ryoshusho')}>
                    {printPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    印刷する / Print
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-lilac">
      {splitScreen}
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

      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_470px] lg:overflow-hidden">
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
            {/* 別々会計は金額のすぐ下（2026-09-25 店舗要望）。「品目ごと」か「金額ごと」を選ぶ。
                品目ごと＝食べた分だけ先に会計（伝票を分ける）。金額ごと＝1枚の伝票を分けて払う */}
            <div className="mb-3 border-b border-line pb-3">
              <button
                type="button"
                onClick={() => {
                  if (splitPick != null || splitMode) {
                    setSplitPick(null);
                    if (splitMode) toggleSplitMode();
                    return;
                  }
                  setSplitOpen((v) => !v);
                }}
                disabled={terminalBlocking}
                aria-pressed={splitPick != null || splitMode}
                className={cn(
                  'tap3d flex h-[46px] w-full flex-col items-center justify-center rounded-xl border text-[14px] font-bold leading-tight disabled:opacity-40',
                  splitPick != null || splitMode ? 'border-iris bg-iris text-white' : 'border-line bg-white text-navy'
                )}
              >
                {splitPick != null ? '別々会計：品目ごと' : splitMode ? '別々会計：金額ごと' : '別々会計'}
                <span
                  className={cn(
                    'text-[10px] font-semibold',
                    splitPick != null || splitMode ? 'text-white/80' : 'text-ink-3'
                  )}
                >
                  Separate payment
                </span>
              </button>

              {splitOpen && splitPick == null && !splitMode && (
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={terminalBlocking || !splitOrderAction || splitLines.length < 2}
                    onClick={() => {
                      setSplitOpen(false);
                      setSplitPick({});
                    }}
                    className="tap3d flex h-[44px] flex-col items-center justify-center rounded-xl border border-line bg-white text-[13px] font-bold leading-tight text-navy disabled:opacity-40"
                  >
                    品目ごと
                    <span className="text-[10px] font-semibold text-ink-3">By item</span>
                  </button>
                  <button
                    type="button"
                    disabled={terminalBlocking}
                    onClick={() => {
                      setSplitOpen(false);
                      toggleSplitMode();
                    }}
                    className="tap3d flex h-[44px] flex-col items-center justify-center rounded-xl border border-line bg-white text-[13px] font-bold leading-tight text-navy disabled:opacity-40"
                  >
                    金額ごと
                    <span className="text-[10px] font-semibold text-ink-3">By price</span>
                  </button>
                </div>
              )}
            </div>

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
            {/* 支払メモ（カードのつもりが現金になった等の理由をその場で残す。2026-09-25 店舗要望） */}
            <label className="mb-2 block">
              <span className="mb-1 block text-[11px] font-bold text-ink-3">
                支払メモ / Payment note<span className="ml-1 font-normal">（任意）</span>
              </span>
              <input
                type="text"
                value={payMemo}
                onChange={(e) => setPayMemo(e.target.value)}
                maxLength={200}
                placeholder="例）カード決済のつもりが現金で受領"
                className="ui-input h-10 w-full border border-line bg-white px-3 text-[14px] text-navy placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/30"
              />
            </label>

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
            {/* 一番多い「現金」は一番上に大きく（2026-09-24 要望） */}
            {rightTab === 'pay' && (
              <button
                type="button"
                disabled={terminalBlocking}
                aria-pressed={payments.some((p) => p.method === 'cash')}
                onClick={() => selectPayment('cash')}
                className={cn(
                  'mb-2 flex h-[54px] w-full flex-col items-center justify-center rounded-xl border text-center text-[18px] font-extrabold leading-tight transition-colors disabled:opacity-50',
                  payments.some((p) => p.method === 'cash') ? payMethodOn : payMethodOff
                )}
              >
                現金
                <span
                  className={cn(
                    'text-[10px] font-semibold',
                    payments.some((p) => p.method === 'cash') ? 'text-white/80' : 'text-ink-3'
                  )}
                >
                  Cash
                </span>
              </button>
            )}

            {rightTab === 'pay' ? (
              <>
                <p className="mb-1.5 text-[11px] font-bold text-ink-3">支払方法 / Payment method</p>

                <div className="grid grid-cols-2 gap-1.5">
                  {BASE_METHODS.map((m) => {
                    // 支払を足したもの＝色、種類（VISA など）を選んでいる最中のものも色（2026-09-24 店舗要望）
                    const selected = payments.some((p) => p.method === m) || openMethod === m;
                    const brands = methodBrands[m] ?? [];
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={terminalBlocking}
                        aria-pressed={selected}
                        aria-expanded={brands.length > 0 ? openMethod === m : undefined}
                        // 内訳（VISA・PayPay など）があるものは、押してから中身を選ぶ
                        onClick={() => (brands.length > 0 ? setOpenMethod((cur) => (cur === m ? null : m)) : selectPayment(m))}
                        className={cn(payMethodBtn, selected ? payMethodOn : payMethodOff)}
                      >
                        <span className="block">{METHOD_LABELS[m]}</span>
                        <span className={cn('block text-[10px] font-semibold', selected ? 'text-white/80' : 'text-ink-3')}>
                          {METHOD_LABELS_EN[m]}
                        </span>
                      </button>
                    );
                  })}
                  {/* ポイントも押してから、どのポイントかを選ぶ（2026-09-24 要望） */}
                  <button
                    type="button"
                    disabled={terminalBlocking}
                    aria-expanded={openMethod === 'points'}
                    aria-pressed={pointsSelected}
                    onClick={() => setOpenMethod((cur) => (cur === 'points' ? null : 'points'))}
                    className={cn(payMethodBtn, pointsSelected || openMethod === 'points' ? payMethodOn : payMethodOff)}
                  >
                    <span className="block">{METHOD_LABELS.points}</span>
                    <span
                      className={cn(
                        'block text-[10px] font-semibold',
                        pointsSelected || openMethod === 'points' ? 'text-white/80' : 'text-ink-3'
                      )}
                    >
                      {METHOD_LABELS_EN.points}
                    </span>
                  </button>
                  {/* 値引はここ（下の項目）から開く（2026-09-24 要望） */}
                  <button
                    type="button"
                    disabled={!canDiscount}
                    onClick={() => setRightTab('discount')}
                    className={cn(payMethodBtn, order.discountTotal > 0 ? payMethodOn : payMethodOff, 'disabled:opacity-40')}
                  >
                    <span className="block">値引</span>
                    <span
                      className={cn(
                        'block text-[10px] font-semibold',
                        order.discountTotal > 0 ? 'text-white/80' : 'text-ink-3'
                      )}
                    >
                      Discount
                    </span>
                  </button>
                </div>

                {/* 押した支払方法の内訳（クレジット→VISA…、QR→PayPay…、ポイント→ホットペッパー…） */}
                {openMethod && (
                  <div className="mt-1.5 rounded-xl border border-line p-2">
                    <p className="mb-1 text-[11px] font-bold text-ink-3">
                      {openMethod === 'points' ? 'どのポイントですか / Choose points' : `${METHOD_LABELS[openMethod]}の種類 / Choose`}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {openMethod === 'points' && (
                        <button
                          type="button"
                          disabled={terminalBlocking || !pointsAvailability.available}
                          aria-pressed={payments.some((p) => p.method === 'points')}
                          title={pointsAvailability.available ? `残高 ${pointsAvailability.balance}pt` : '顧客紐付け・会員機能有効・残高が必要です'}
                          onClick={() => selectPayment('points')}
                          className={cn(pointBrandBtn, payments.some((p) => p.method === 'points') ? pointBrandOn : pointBrandOff)}
                        >
                          自社ポイント
                        </button>
                      )}
                      {(openMethod === 'points' ? pointBrands : (methodBrands[openMethod] ?? [])).map((b) => {
                        const method = openMethod === 'points' ? 'site_points' : (openMethod as CheckoutPayment['method']);
                        const selected = payments.some((p) => p.method === method && p.provider === b.key);
                        return (
                          <button
                            key={b.key}
                            type="button"
                            disabled={terminalBlocking}
                            aria-pressed={selected}
                            onClick={() => selectPayment(method, b.key)}
                            className={cn(pointBrandBtn, selected ? pointBrandOn : pointBrandOff)}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                    </div>
                    {openMethod === 'points' && !pointsAvailability.available && (
                      <p className="mt-1 text-[10px] text-ink-3">自社ポイントは、お客様を伝票に紐付けて残高があるときだけ使えます</p>
                    )}
                  </div>
                )}

                {payments.some((p) => TERMINAL_METHODS.includes(p.method)) && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    決済端末（stera 等）で決済してから「会計する」を押してください。
                  </p>
                )}

                {/* 金額表示とテンキー（選んだ支払方法の金額・現金は預り金を入力する） */}
                <div className="mt-2 rounded-xl bg-plum px-4 py-2 text-right text-[30px] font-extrabold tabular-nums text-white">
                  {activeRow ? activeValue.toLocaleString() : 0}
                </div>
                <p className="mt-1 text-right text-[11px] text-ink-3">
                  {activeRow ? (activeRow.method === 'cash' ? '預り金を入力' : `${METHOD_LABELS[activeRow.method]}の金額`) : '支払方法を選んでください'}
                </p>

                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {QUICK_CASH_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      disabled={!activeRow}
                      onClick={() => setActiveValue(activeValue + amt)}
                      className="flex h-10 items-center justify-center rounded-xl border border-line bg-white text-[15px] font-bold tabular-nums text-navy active:bg-lilac disabled:opacity-40"
                    >
                      {amt.toLocaleString()}
                    </button>
                  ))}
                </div>

                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  <button type="button" disabled={!activeRow} onClick={() => setActiveValue(0)} className={cn(keySmall, 'text-danger')}>
                    C
                    <span className="text-[10px] font-semibold text-danger/70">Clear</span>
                  </button>
                  <button
                    type="button"
                    disabled={!activeRow}
                    onClick={() => setActiveValue(activeRow?.method === 'cash' ? (activeRow?.amount ?? 0) : Math.max(0, remaining) + (activeRow?.amount ?? 0))}
                    className={keySmall}
                  >
                    ちょうど
                    <span className={keySmallEn}>Exact</span>
                  </button>
                  <button
                    type="button"
                    disabled={!activeRow}
                    onClick={() => setActiveValue(Math.floor(activeValue / 10))}
                    className={keySmall}
                    aria-label="1文字消す / Delete"
                  >
                    {/* パソコンのキーボードと同じ「消す」の印（⌫） */}
                    <Delete className="h-6 w-6" aria-hidden />
                    <span className={keySmallEn}>Delete</span>
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
                    className="flex h-[52px] flex-col items-center justify-center rounded-xl bg-iris text-lg font-bold leading-tight text-white active:bg-iris-deep disabled:opacity-40"
                  >
                    決定
                    <span className="text-[10px] font-semibold text-white/75">Confirm</span>
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
              <div className="space-y-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-navy">
                    値引<span className="ml-1 text-[10px] font-semibold text-ink-3">Discount</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setRightTab('pay')}
                    className="flex items-center gap-1 rounded-full bg-lilac px-3 py-1 text-[11px] font-bold text-ink-2"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    支払へ戻る
                    <span className="text-[9px] font-semibold text-ink-3">Back</span>
                  </button>
                </div>
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
