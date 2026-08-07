/**
 * 決済プロバイダー抽象化レイヤー。
 * TENPO ONE本体はこのインターフェースにのみ依存し、Stripe等の実装は
 * アダプター（lib/payments/stripe.ts 等）に隠蔽する。
 *
 * 将来の追加候補: square / airpay / stera / paygate
 */

export type PaymentProviderName = 'stripe' | 'square' | 'airpay' | 'stera' | 'paygate';

export type PaymentPurpose =
  | 'pos_charge'
  | 'booking_prepay'
  | 'booking_deposit'
  | 'cancellation_fee'
  | 'payment_link';

/** payment_intents.status と同一 */
export type LocalIntentStatus =
  | 'created'
  | 'processing'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'refunded';

export interface CreateIntentInput {
  amountYen: number;
  purpose: PaymentPurpose;
  idempotencyKey: string;
  /** カード提示型（Terminal）か否か */
  cardPresent: boolean;
  metadata: Record<string, string>;
}

export interface ProviderIntent {
  providerIntentId: string;
  status: LocalIntentStatus;
  chargeId: string | null;
  errorMessage: string | null;
}

export interface CheckoutSessionInput {
  amountYen: number;
  productName: string;
  purpose: PaymentPurpose;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  metadata: Record<string, string>;
}

export interface ProviderCheckoutSession {
  sessionId: string;
  url: string;
  providerIntentId: string | null;
}

export interface ProviderReader {
  providerReaderId: string;
  label: string;
  deviceType: string | null;
  status: 'online' | 'offline' | 'unknown';
  isSimulated: boolean;
}

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName;
  /** 環境変数等の設定が揃っているか */
  isConfigured(): boolean;
  /** テストモードか（本番キー使用時 false） */
  isTestMode(): boolean;

  createIntent(input: CreateIntentInput): Promise<ProviderIntent>;
  getIntent(providerIntentId: string): Promise<ProviderIntent>;
  cancelIntent(providerIntentId: string): Promise<ProviderIntent>;
  refund(input: {
    providerIntentId: string;
    amountYen: number;
    idempotencyKey: string;
    reason?: string;
  }): Promise<{ providerRefundId: string }>;

  /** Terminal: 端末へ決済要求を送る */
  processOnReader(providerReaderId: string, providerIntentId: string): Promise<void>;
  /** Terminal(simulated専用): テストカードの擬似提示 */
  simulatePresentCard(providerReaderId: string): Promise<void>;
  registerSimulatedReader(label: string): Promise<ProviderReader>;
  listReaders(): Promise<ProviderReader[]>;

  createCheckoutSession(input: CheckoutSessionInput): Promise<ProviderCheckoutSession>;
}

// -------------------------------------------------------------
// 純関数（テスト対象）
// -------------------------------------------------------------

/**
 * POS会計のidempotencyキー。同一注文×同一金額の再試行は同一キー
 * （プロバイダー側でも同一リクエストと判定され二重決済にならない）。
 * 金額が変わると別キーになるため、旧intentはキャンセルして作り直す。
 */
export function posIdempotencyKey(orderId: string, amountYen: number): string {
  return `pos:${orderId}:${amountYen}`;
}

/** 予約決済のidempotencyキー（予約×用途×金額で一意） */
export function bookingIdempotencyKey(
  reservationId: string,
  purpose: PaymentPurpose,
  amountYen: number
): string {
  return `book:${reservationId}:${purpose}:${amountYen}`;
}

/** 返金のidempotencyキー */
export function refundIdempotencyKey(localIntentId: string, amountYen: number, seq: number): string {
  return `refund:${localIntentId}:${amountYen}:${seq}`;
}

/**
 * 予約時のオンライン決済額を決める。
 * - onsite: 0（現地払い）
 * - prepay_full: コース価格 × 人数（コース未選択なら0 = 決済不要）
 * - deposit: 予約金 × 人数
 */
export function computeBookingCharge(opts: {
  mode: 'onsite' | 'prepay_full' | 'deposit';
  depositAmount: number;
  coursePrice: number | null;
  partySize: number;
}): { amountYen: number; purpose: PaymentPurpose | null } {
  if (opts.mode === 'deposit' && opts.depositAmount > 0) {
    return { amountYen: opts.depositAmount * opts.partySize, purpose: 'booking_deposit' };
  }
  if (opts.mode === 'prepay_full' && opts.coursePrice && opts.coursePrice > 0) {
    return { amountYen: opts.coursePrice * opts.partySize, purpose: 'booking_prepay' };
  }
  return { amountYen: 0, purpose: null };
}

/** 金額の妥当性（円の正の整数のみ許可） */
export function isValidChargeAmount(amountYen: number): boolean {
  return Number.isInteger(amountYen) && amountYen > 0 && amountYen <= 10_000_000;
}
