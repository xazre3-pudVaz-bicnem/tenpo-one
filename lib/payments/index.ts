import 'server-only';
import type { PaymentProviderAdapter, PaymentProviderName } from './types';
import { stripeProvider } from './stripe';

/**
 * プロバイダー解決。現状はStripeのみ。
 * 将来: payment_providers テーブルの organization 設定に応じて切り替える。
 */
const ADAPTERS: Partial<Record<PaymentProviderName, PaymentProviderAdapter>> = {
  stripe: stripeProvider,
};

export function getPaymentProvider(name: PaymentProviderName = 'stripe'): PaymentProviderAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`未対応の決済プロバイダーです: ${name}`);
  return adapter;
}

/** 決済機能が利用可能か（UI表示ゲート用） */
export function isPaymentConfigured(): boolean {
  return stripeProvider.isConfigured();
}

/** テストモード表示用 */
export function isPaymentTestMode(): boolean {
  return stripeProvider.isConfigured() && stripeProvider.isTestMode();
}
