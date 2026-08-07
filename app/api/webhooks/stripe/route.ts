import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { constructStripeEvent } from '@/lib/payments/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Stripe Webhook 受信エンドポイント。
 * - 署名検証必須（失敗は400）
 * - webhook_events (provider, event_id) UNIQUE で冪等化（同一イベント再送は処理せず200）
 * - ビジネス処理の失敗は status='failed' に隔離して200を返す（Stripe再送に依存しない）
 */

export const runtime = 'nodejs';

const HANDLED_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'checkout.session.completed',
]);

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(rawBody, signature);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 冪等化: 既に受信済みのイベントIDなら処理しない
  const { error: insertError } = await admin.from('webhook_events').insert({
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload: event.data.object as unknown as Record<string, unknown>,
    status: HANDLED_EVENTS.has(event.type) ? 'received' : 'skipped',
  });
  if (insertError) {
    if (insertError.code === '23505') {
      // 重複受信 — 正常（処理済み）として応答
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: 'event log failed' }, { status: 500 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    await handleEvent(admin, event);
    await admin
      .from('webhook_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
  } catch (e) {
    await admin
      .from('webhook_events')
      .update({ status: 'failed', error: e instanceof Error ? e.message : String(e) })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
  }

  return NextResponse.json({ received: true });
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function handleEvent(admin: AdminClient, event: Stripe.Event) {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await admin
        .from('payment_intents')
        .update({
          status: 'succeeded',
          provider_charge_id:
            typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null),
          error_message: null,
        })
        .eq('provider', 'stripe')
        .eq('provider_payment_intent_id', pi.id)
        .in('status', ['created', 'processing', 'requires_action']);
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await admin
        .from('payment_intents')
        .update({
          status: 'failed',
          error_message: pi.last_payment_error?.message ?? '決済に失敗しました',
        })
        .eq('provider', 'stripe')
        .eq('provider_payment_intent_id', pi.id)
        .in('status', ['created', 'processing', 'requires_action']);
      break;
    }
    case 'payment_intent.canceled': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await admin
        .from('payment_intents')
        .update({ status: 'canceled' })
        .eq('provider', 'stripe')
        .eq('provider_payment_intent_id', pi.id)
        .in('status', ['created', 'processing', 'requires_action']);
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (piId) {
        await admin
          .from('payment_intents')
          .update({ status: 'refunded' })
          .eq('provider', 'stripe')
          .eq('provider_payment_intent_id', piId);
      }
      break;
    }
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
      if (piId) {
        // Checkout経由: セッションIDからintent IDを補完（作成時はintent未確定のため）
        await admin
          .from('payment_intents')
          .update({ provider_payment_intent_id: piId })
          .eq('provider', 'stripe')
          .eq('provider_checkout_session_id', session.id)
          .is('provider_payment_intent_id', null);
      }
      break;
    }
  }
}
