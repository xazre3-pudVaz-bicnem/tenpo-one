import 'server-only';
import Stripe from 'stripe';
import type {
  CheckoutSessionInput,
  CreateIntentInput,
  LocalIntentStatus,
  PaymentProviderAdapter,
  ProviderCheckoutSession,
  ProviderIntent,
  ProviderReader,
} from './types';

/**
 * Stripeアダプター（サーバー専用）。
 * STRIPE_SECRET_KEY はサーバー環境変数のみ。クライアントへ渡さない。
 * カード番号・CVCは扱わない（Stripe側で完結し、IDのみ受け取る）。
 */

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY が設定されていません');
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

/** StripeのPaymentIntentステータスをTENPO ONEのステータスへ正規化 */
export function mapStripeIntentStatus(status: Stripe.PaymentIntent.Status): LocalIntentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'canceled':
      return 'canceled';
    case 'requires_action':
    case 'requires_confirmation':
      return 'requires_action';
    case 'requires_payment_method':
    case 'requires_capture':
    default:
      return 'created';
  }
}

function toProviderIntent(pi: Stripe.PaymentIntent): ProviderIntent {
  return {
    providerIntentId: pi.id,
    status: mapStripeIntentStatus(pi.status),
    chargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null),
    errorMessage: pi.last_payment_error?.message ?? null,
  };
}

function toProviderReader(r: Stripe.Terminal.Reader): ProviderReader {
  return {
    providerReaderId: r.id,
    label: r.label ?? r.id,
    deviceType: r.device_type ?? null,
    status: r.status === 'online' ? 'online' : r.status === 'offline' ? 'offline' : 'unknown',
    isSimulated: r.device_type === 'simulated_wisepos_e' || !!r.livemode === false,
  };
}

export const stripeProvider: PaymentProviderAdapter = {
  name: 'stripe',

  isConfigured() {
    return !!process.env.STRIPE_SECRET_KEY;
  },

  isTestMode() {
    return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_');
  },

  async createIntent(input: CreateIntentInput): Promise<ProviderIntent> {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.create(
      {
        amount: input.amountYen, // JPYはゼロ小数通貨のため円をそのまま渡す
        currency: 'jpy',
        payment_method_types: input.cardPresent ? ['card_present'] : ['card'],
        capture_method: 'automatic',
        metadata: { ...input.metadata, tenpo_purpose: input.purpose },
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return toProviderIntent(pi);
  },

  async getIntent(providerIntentId: string): Promise<ProviderIntent> {
    const pi = await getStripe().paymentIntents.retrieve(providerIntentId);
    return toProviderIntent(pi);
  },

  async cancelIntent(providerIntentId: string): Promise<ProviderIntent> {
    const pi = await getStripe().paymentIntents.cancel(providerIntentId);
    return toProviderIntent(pi);
  },

  async refund({ providerIntentId, amountYen, idempotencyKey, reason }) {
    const refund = await getStripe().refunds.create(
      {
        payment_intent: providerIntentId,
        amount: amountYen,
        metadata: reason ? { tenpo_reason: reason } : undefined,
      },
      { idempotencyKey }
    );
    return { providerRefundId: refund.id };
  },

  async processOnReader(providerReaderId: string, providerIntentId: string): Promise<void> {
    await getStripe().terminal.readers.processPaymentIntent(providerReaderId, {
      payment_intent: providerIntentId,
    });
  },

  async simulatePresentCard(providerReaderId: string): Promise<void> {
    await getStripe().testHelpers.terminal.readers.presentPaymentMethod(providerReaderId);
  },

  async registerSimulatedReader(label: string): Promise<ProviderReader> {
    const stripe = getStripe();
    if (!this.isTestMode()) {
      throw new Error('シミュレーション端末はテストモードでのみ登録できます');
    }
    const reader = await stripe.terminal.readers.create({
      registration_code: 'simulated-wpe',
      label,
    });
    return toProviderReader(reader);
  },

  async listReaders(): Promise<ProviderReader[]> {
    const readers = await getStripe().terminal.readers.list({ limit: 100 });
    return readers.data.map(toProviderReader);
  },

  async createCheckoutSession(input: CheckoutSessionInput): Promise<ProviderCheckoutSession> {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'ja',
        line_items: [
          {
            price_data: {
              currency: 'jpy',
              unit_amount: input.amountYen,
              product_data: { name: input.productName },
            },
            quantity: 1,
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail ?? undefined,
        payment_intent_data: { metadata: { ...input.metadata, tenpo_purpose: input.purpose } },
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return {
      sessionId: session.id,
      url: session.url ?? '',
      providerIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    };
  },
};

/** Webhook署名検証（サーバー専用） */
export function constructStripeEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET が設定されていません');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
