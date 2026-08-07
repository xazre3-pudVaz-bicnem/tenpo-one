/**
 * Stripe Test Mode 検証スクリプト
 *
 * 使い方: node --env-file=.env.local scripts/verify-stripe.mjs
 * 前提: STRIPE_SECRET_KEY（sk_test_...）が設定済みであること。本番キーでは実行不可。
 *
 * 検証内容:
 *   1. simulated reader の登録
 *   2. PaymentIntent（card_present, JPY）の作成
 *   3. 端末への決済要求 → テストカード擬似提示
 *   4. succeeded までのポーリング確認
 *   5. idempotencyキー再利用で同一intentが返ること（二重決済防止）
 *   6. 一部返金
 *   7. Checkout Session（予約事前決済相当）の作成
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY が未設定です。Stripe Dashboard（Test Mode）のキーを .env.local へ設定してください');
  process.exit(1);
}
if (!key.startsWith('sk_test_')) {
  console.error('本番キーが検出されました。本スクリプトはテストキー（sk_test_）専用です');
  process.exit(1);
}

const stripe = new Stripe(key);
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Stripe Test Mode 検証 ===');

  // 1. simulated reader
  const reader = await stripe.terminal.readers.create({
    registration_code: 'simulated-wpe',
    label: `検証端末 ${new Date().toISOString().slice(0, 16)}`,
  });
  check('simulated reader を登録', reader.id.startsWith('tmr_'), reader.id);

  // 2. PaymentIntent（JPY・card_present）
  const idemKey = `verify:pos:${Date.now()}:2180`;
  const intent = await stripe.paymentIntents.create(
    { amount: 2180, currency: 'jpy', payment_method_types: ['card_present'] },
    { idempotencyKey: idemKey }
  );
  check('PaymentIntent 作成（¥2,180）', intent.amount === 2180 && intent.currency === 'jpy');

  // 5'. idempotency: 同一キー再送で同一intentが返る
  const intentAgain = await stripe.paymentIntents.create(
    { amount: 2180, currency: 'jpy', payment_method_types: ['card_present'] },
    { idempotencyKey: idemKey }
  );
  check('同一idempotencyキーの再送は同一intent（二重決済なし）', intentAgain.id === intent.id);

  // 3. 端末へ決済要求 → テストカード提示
  await stripe.terminal.readers.processPaymentIntent(reader.id, { payment_intent: intent.id });
  await stripe.testHelpers.terminal.readers.presentPaymentMethod(reader.id);
  check('端末へ決済要求・テストカード擬似提示', true);

  // 4. succeeded までポーリング
  let status = intent.status;
  for (let i = 0; i < 20 && status !== 'succeeded'; i++) {
    await sleep(1000);
    status = (await stripe.paymentIntents.retrieve(intent.id)).status;
  }
  check('決済が succeeded になる', status === 'succeeded', `最終状態: ${status}`);

  // 6. 一部返金
  const refund = await stripe.refunds.create(
    { payment_intent: intent.id, amount: 500 },
    { idempotencyKey: `verify:refund:${intent.id}:500:1` }
  );
  check('一部返金（¥500）', refund.status === 'succeeded' || refund.status === 'pending', refund.status);

  // 7. Checkout Session（予約事前決済相当）
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'ja',
    line_items: [{
      price_data: { currency: 'jpy', unit_amount: 11000, product_data: { name: '検証: コース事前決済（2名様）' } },
      quantity: 1,
    }],
    success_url: 'https://example.com/booking/TEST?paid=1',
    cancel_url: 'https://example.com/booking/TEST?payment=cancelled',
  });
  check('Checkout Session 作成（URL発行）', !!session.url);

  // 後片付け（テスト環境の端末を削除）
  await stripe.terminal.readers.del(reader.id);

  console.log(`\n結果: 成功 ${pass} / 失敗 ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('※ Webhook検証は `stripe listen --forward-to localhost:3000/api/webhooks/stripe` で別途実施');
}

main().catch((e) => { console.error('検証中断:', e.message); process.exit(1); });
