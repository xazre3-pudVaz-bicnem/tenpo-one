'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPaymentProvider, isPaymentConfigured, isPaymentTestMode } from '@/lib/payments';
import { posIdempotencyKey, isValidChargeAmount } from '@/lib/payments/types';

/**
 * POS × Stripe Terminal（サーバー駆動）決済アクション。
 * 二重決済防止:
 *  - payment_intents.idempotency_key（pos:{order}:{amount}）のDB UNIQUE
 *  - Stripeへ同一idempotencyKeyを渡す
 *  - finalize_order は open 以外の注文を拒否
 */

export interface TerminalPaymentState {
  ok: boolean;
  error?: string;
  localIntentId?: string;
  status?: string;
  finalized?: boolean;
}

function hasStoreAccess(ctx: { isHq: boolean; stores: { id: string }[] }, storeId: string | null | undefined): boolean {
  return ctx.isHq || (!!storeId && ctx.stores.some((s) => s.id === storeId));
}

/** 端末決済を開始する（intent作成→端末へ送信→simulatedならテストカード提示） */
export async function startTerminalPayment(
  orderId: string,
  readerId: string
): Promise<TerminalPaymentState> {
  const ctx = await requirePermission('pos.checkout');
  if (!isPaymentConfigured()) {
    return { ok: false, error: 'Stripeが未設定です。設定画面からテストキーを登録してください' };
  }
  const supabase = await createClient();
  const provider = getPaymentProvider('stripe');

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (!hasStoreAccess(ctx, order.store_id)) return { ok: false, error: 'この店舗の操作はできません' };
  if (order.status !== 'open') return { ok: false, error: 'この注文は会計済みです' };

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  const { data: fresh } = await supabase.from('orders').select('total').eq('id', orderId).single();
  const amount = fresh?.total ?? 0;
  if (!isValidChargeAmount(amount)) return { ok: false, error: '決済金額が不正です' };

  const { data: reader } = await supabase.from('terminal_readers').select('*').eq('id', readerId).single();
  if (!reader) return { ok: false, error: '決済端末が見つかりません' };
  if (reader.store_id !== order.store_id) return { ok: false, error: 'この決済端末は対象の注文の店舗と一致しません' };

  const key = posIdempotencyKey(orderId, amount);

  // 同一キーの既存intentがあれば再利用（リトライ・二重押下対策）
  const { data: existing } = await supabase
    .from('payment_intents')
    .select('*')
    .eq('idempotency_key', key)
    .maybeSingle();

  try {
    if (existing && ['succeeded', 'processing', 'requires_action', 'created'].includes(existing.status)) {
      if (existing.status === 'succeeded') {
        return { ok: true, localIntentId: existing.id, status: 'succeeded' };
      }
      // 端末へ再送（同一intent）
      if (existing.provider_payment_intent_id) {
        await provider.processOnReader(reader.provider_reader_id, existing.provider_payment_intent_id);
        if (reader.is_simulated) await provider.simulatePresentCard(reader.provider_reader_id);
        return { ok: true, localIntentId: existing.id, status: existing.status };
      }
    }

    // 金額変更等で別キーになった旧intentはキャンセルしておく
    const { data: stale } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('order_id', orderId)
      .in('status', ['created', 'processing', 'requires_action'])
      .neq('idempotency_key', key);
    for (const s of stale ?? []) {
      if (s.provider_payment_intent_id) {
        try {
          await provider.cancelIntent(s.provider_payment_intent_id);
        } catch {
          // 既にキャンセル済み等は無視
        }
      }
      await supabase.from('payment_intents').update({ status: 'canceled' }).eq('id', s.id);
    }

    const intent = await provider.createIntent({
      amountYen: amount,
      purpose: 'pos_charge',
      idempotencyKey: key,
      cardPresent: true,
      metadata: { order_id: orderId, store_id: order.store_id, organization_id: order.organization_id },
    });

    const { data: local, error: insertError } = await supabase
      .from('payment_intents')
      .upsert(
        {
          organization_id: order.organization_id,
          store_id: order.store_id,
          provider: 'stripe',
          purpose: 'pos_charge',
          order_id: orderId,
          customer_id: order.customer_id,
          amount,
          status: intent.status,
          provider_payment_intent_id: intent.providerIntentId,
          reader_id: readerId,
          idempotency_key: key,
          created_by: ctx.userId,
        },
        { onConflict: 'idempotency_key' }
      )
      .select()
      .single();
    if (insertError) return { ok: false, error: `決済記録の保存に失敗しました: ${insertError.message}` };

    await provider.processOnReader(reader.provider_reader_id, intent.providerIntentId);
    if (reader.is_simulated) {
      await provider.simulatePresentCard(reader.provider_reader_id);
    }
    await supabase
      .from('terminal_readers')
      .update({ last_seen_at: new Date().toISOString(), status: 'online' })
      .eq('id', readerId);

    return { ok: true, localIntentId: local.id, status: intent.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済の開始に失敗しました' };
  }
}

/**
 * 決済状態を確認し、成功していれば会計を確定する（何度呼んでも冪等）。
 * finalize_order が open 以外を拒否するため会計の二重確定は起きない。
 */
export async function checkTerminalPayment(localIntentId: string): Promise<TerminalPaymentState> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const provider = getPaymentProvider('stripe');

  const { data: local } = await supabase.from('payment_intents').select('*').eq('id', localIntentId).single();
  if (!local) return { ok: false, error: '決済が見つかりません' };
  if (!hasStoreAccess(ctx, local.store_id)) return { ok: false, error: 'この店舗の操作はできません' };

  let status = local.status;
  let chargeId: string | null = local.provider_charge_id;
  if (!['succeeded', 'failed', 'canceled', 'refunded'].includes(status) && local.provider_payment_intent_id) {
    try {
      const remote = await provider.getIntent(local.provider_payment_intent_id);
      status = remote.status;
      chargeId = remote.chargeId ?? chargeId;
      await supabase
        .from('payment_intents')
        .update({ status, provider_charge_id: chargeId, error_message: remote.errorMessage })
        .eq('id', localIntentId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '決済状態の確認に失敗しました' };
    }
  }

  if (status !== 'succeeded') {
    return { ok: true, localIntentId, status, finalized: false };
  }

  // 会計確定（注文がまだopenの場合のみ）
  const { data: order } = await supabase.from('orders').select('*').eq('id', local.order_id).single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (order.status !== 'open') {
    return { ok: true, localIntentId, status: 'succeeded', finalized: true };
  }

  const { data: session } = await supabase
    .from('register_sessions')
    .select('id')
    .eq('store_id', order.store_id)
    .eq('status', 'open')
    .maybeSingle();

  const { error: finError } = await supabase.rpc('finalize_order', {
    p_order_id: order.id,
    p_payments: [{ method: 'credit', amount: local.amount }],
    p_register_session_id: session?.id ?? null,
  });
  if (finError) return { ok: false, error: `会計確定に失敗しました: ${finError.message}` };

  // payments 行へStripeのIDを関連付け
  await supabase
    .from('payments')
    .update({
      provider: 'stripe',
      provider_payment_intent_id: local.provider_payment_intent_id,
      provider_charge_id: chargeId,
    })
    .eq('order_id', order.id)
    .eq('method', 'credit')
    .is('provider_payment_intent_id', null);

  revalidatePath('/app/pos');
  revalidatePath('/app/orders');
  return { ok: true, localIntentId, status: 'succeeded', finalized: true };
}

/** 端末決済のキャンセル（注文は open のまま。他の支払方法で会計可能） */
export async function cancelTerminalPayment(localIntentId: string): Promise<TerminalPaymentState> {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const provider = getPaymentProvider('stripe');

  const { data: local } = await supabase.from('payment_intents').select('*').eq('id', localIntentId).single();
  if (!local) return { ok: false, error: '決済が見つかりません' };
  if (!hasStoreAccess(ctx, local.store_id)) return { ok: false, error: 'この店舗の操作はできません' };
  if (local.status === 'succeeded') return { ok: false, error: '成功済みの決済はキャンセルできません（返金をご利用ください）' };

  try {
    if (local.provider_payment_intent_id) {
      await provider.cancelIntent(local.provider_payment_intent_id);
    }
  } catch {
    // Stripe側で既に完了/キャンセル済みの場合は状態確認に委ねる
  }
  await supabase.from('payment_intents').update({ status: 'canceled' }).eq('id', localIntentId);
  return { ok: true, localIntentId, status: 'canceled' };
}

/** 決済設定の状態（UIゲート用） */
export async function getPaymentAvailability(): Promise<{
  configured: boolean;
  testMode: boolean;
}> {
  await requirePermission('pos.checkout');
  return { configured: isPaymentConfigured(), testMode: isPaymentTestMode() };
}
