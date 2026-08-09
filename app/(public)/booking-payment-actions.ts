'use server';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentProvider, isPaymentConfigured } from '@/lib/payments';
import { bookingIdempotencyKey, computeBookingCharge, isValidChargeAmount } from '@/lib/payments/types';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { newErrorId, logStructuredError, userFacingError } from '@/lib/observability';

/** 匿名公開アクションのIPベースレート制限キー（x-forwarded-for優先、無ければx-real-ip） */
async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/**
 * 公開予約のオンライン決済（Stripe Checkout）。
 * 匿名ユーザーからの呼び出しのため、予約コード+電話番号で本人性を検証してから
 * admin クライアントで処理する（テーブルへの直接アクセス権は与えない）。
 */

export interface BookingCheckoutResult {
  ok: boolean;
  /** 決済不要（現地払い/対象金額なし） */
  notRequired?: boolean;
  url?: string;
  amount?: number;
  error?: string;
}

export async function createBookingCheckout(
  code: string,
  phone: string
): Promise<BookingCheckoutResult> {
  if (!code || !phone || phone.length < 10) {
    return { ok: false, error: '予約コードと電話番号を確認してください' };
  }
  const ip = await requestIp();
  if (!rateLimiter.check(`booking-checkout:${ip}`, RATE_LIMITS.bookingCheckout.limit, RATE_LIMITS.bookingCheckout.windowMs)) {
    return { ok: false, error: 'リクエストが多すぎます。しばらく待ってから再試行してください' };
  }
  if (!isPaymentConfigured()) {
    return { ok: false, notRequired: true };
  }

  const admin = createAdminClient();

  // 本人性検証: コード+電話番号一致の予約のみ
  const { data: reservation } = await admin
    .from('reservations')
    .select('*, stores(slug, name), menu_items:course_id(price, name)')
    .eq('code', code.toUpperCase())
    .eq('guest_phone', phone)
    .maybeSingle();
  if (!reservation) return { ok: false, error: '予約が見つかりません' };
  if (!['pending', 'confirmed'].includes(reservation.status)) {
    return { ok: false, error: 'この予約は決済できる状態ではありません' };
  }

  const { data: settings } = await admin
    .from('store_settings')
    .select('booking_payment_mode, booking_deposit_amount')
    .eq('store_id', reservation.store_id)
    .single();

  const course = reservation.menu_items as unknown as { price: number; name: string } | null;
  const { amountYen, purpose } = computeBookingCharge({
    mode: (settings?.booking_payment_mode ?? 'onsite') as 'onsite' | 'prepay_full' | 'deposit',
    depositAmount: settings?.booking_deposit_amount ?? 0,
    coursePrice: course?.price ?? null,
    partySize: reservation.party_size,
  });
  if (!purpose || !isValidChargeAmount(amountYen)) {
    return { ok: true, notRequired: true };
  }

  // 既に成功済みなら再決済させない
  const { data: paid } = await admin
    .from('payment_intents')
    .select('id')
    .eq('reservation_id', reservation.id)
    .eq('purpose', purpose)
    .eq('status', 'succeeded')
    .limit(1);
  if (paid?.length) return { ok: false, error: 'この予約は既にお支払い済みです' };

  const store = reservation.stores as unknown as { slug: string; name: string };
  const headerList = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${headerList.get('x-forwarded-proto') ?? 'https'}://${headerList.get('host')}`;

  const key = bookingIdempotencyKey(reservation.id, purpose, amountYen);
  const provider = getPaymentProvider('stripe');

  try {
    const session = await provider.createCheckoutSession({
      amountYen,
      productName:
        purpose === 'booking_deposit'
          ? `${store.name} ご予約金（${reservation.party_size}名様）`
          : `${store.name} ${course?.name ?? 'コース'} 事前決済（${reservation.party_size}名様）`,
      purpose,
      idempotencyKey: key,
      successUrl: `${origin}/booking/${reservation.code}?paid=1`,
      cancelUrl: `${origin}/booking/${reservation.code}?payment=cancelled`,
      customerEmail: reservation.guest_email,
      metadata: {
        reservation_id: reservation.id,
        reservation_code: reservation.code,
        store_id: reservation.store_id,
        organization_id: reservation.organization_id,
      },
    });

    await admin.from('payment_intents').upsert(
      {
        organization_id: reservation.organization_id,
        store_id: reservation.store_id,
        provider: 'stripe',
        purpose,
        reservation_id: reservation.id,
        customer_id: reservation.customer_id,
        amount: amountYen,
        status: 'created',
        provider_checkout_session_id: session.sessionId,
        provider_payment_intent_id: session.providerIntentId,
        idempotency_key: key,
        metadata: { reservation_code: reservation.code },
      },
      { onConflict: 'idempotency_key' }
    );

    return { ok: true, url: session.url, amount: amountYen };
  } catch (e) {
    // Stripe/内部エラーの生メッセージを匿名クライアントへ返さない。IDのみ提示しサーバーに記録。
    const errorId = newErrorId();
    logStructuredError(errorId, e instanceof Error ? e.message : String(e), { route: 'booking:create_payment_session', severity: 'error' });
    return { ok: false, error: userFacingError(errorId, '決済ページの作成に失敗しました') };
  }
}

/** 予約の決済状態（公開照会画面用。コード+電話で検証） */
export async function getBookingPaymentStatus(
  code: string,
  phone: string
): Promise<{ paid: boolean; amount: number | null; required: boolean }> {
  const ip = await requestIp();
  if (!rateLimiter.check(`booking-status:${ip}`, RATE_LIMITS.bookingCheckout.limit, RATE_LIMITS.bookingCheckout.windowMs)) {
    return { paid: false, amount: null, required: false };
  }
  const admin = createAdminClient();
  const { data: reservation } = await admin
    .from('reservations')
    .select('id, store_id, party_size, course_id, menu_items:course_id(price)')
    .eq('code', code.toUpperCase())
    .eq('guest_phone', phone)
    .maybeSingle();
  if (!reservation) return { paid: false, amount: null, required: false };

  const { data: intents } = await admin
    .from('payment_intents')
    .select('status, amount')
    .eq('reservation_id', reservation.id)
    .in('purpose', ['booking_prepay', 'booking_deposit']);
  const succeeded = (intents ?? []).find((i) => i.status === 'succeeded');
  if (succeeded) return { paid: true, amount: succeeded.amount, required: true };

  if (!isPaymentConfigured()) return { paid: false, amount: null, required: false };
  const { data: settings } = await admin
    .from('store_settings')
    .select('booking_payment_mode, booking_deposit_amount')
    .eq('store_id', reservation.store_id)
    .single();
  const course = reservation.menu_items as unknown as { price: number } | null;
  const { amountYen, purpose } = computeBookingCharge({
    mode: (settings?.booking_payment_mode ?? 'onsite') as 'onsite' | 'prepay_full' | 'deposit',
    depositAmount: settings?.booking_deposit_amount ?? 0,
    coursePrice: course?.price ?? null,
    partySize: reservation.party_size,
  });
  return { paid: false, amount: amountYen > 0 ? amountYen : null, required: !!purpose && amountYen > 0 };
}
