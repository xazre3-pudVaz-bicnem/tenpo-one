'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushNewReservation } from '@/lib/push-server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { safePublicErrorCode } from '@/lib/observability';
import type { CreateReservationResult } from '@/components/booking/types';
import { bookingCouponsFrom, couponLabel, requestWithCoupon } from '@/lib/booking-coupons';

/** 匿名公開アクションのIPベースレート制限キー（x-forwarded-for優先、無ければx-real-ip） */
async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export interface CreatePublicReservationInput {
  slug: string;
  date: string;
  time: string;
  party: number;
  adults: number;
  children: number;
  name: string;
  kana: string | null;
  phone: string;
  email: string | null;
  courseId: string | null;
  seatType: string | null;
  purpose: string | null;
  allergy: string | null;
  request: string | null;
  /** 選んだ当店のクーポン（id。無ければ null） */
  couponId?: string | null;
  sourceCode: string;
  consent: boolean;
}

export interface CreatePublicReservationResult {
  data: CreateReservationResult | null;
  /** RPCのエラーコード（生の文字列）。表示用メッセージへの変換は呼び出し側（bookingErrorMessage）で行う */
  errorMessage: string | null;
}

/**
 * 公開予約フォーム（booking-wizard）からの予約作成。
 * 以前はクライアントから直接 supabase.rpc('create_public_reservation', ...) を anon key で
 * 呼んでおり、アプリ層のレート制限が一切かかっていなかった（DB側 booking_request_logs 頼み）。
 * このServer Actionを経由させることでIPベースのレート制限を二層目として追加する。
 */
export async function createPublicReservation(
  input: CreatePublicReservationInput
): Promise<CreatePublicReservationResult> {
  const ip = await requestIp();
  if (
    !rateLimiter.check(
      `public-reservation:${ip}`,
      RATE_LIMITS.publicReservation.limit,
      RATE_LIMITS.publicReservation.windowMs
    )
  ) {
    return { data: null, errorMessage: 'RATE_LIMITED' };
  }

  // 選んだクーポンは、ご予約の「ご要望」の先頭に【クーポン】として残す（台帳・ハンディで見える）。
  // 文はお店の設定から作る（お客様の画面から来た文は使わない）
  const couponText = input.couponId ? await couponLabelFor(input.slug, input.couponId) : null;
  const request = requestWithCoupon(couponText, input.request);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_public_reservation', {
    p_slug: input.slug,
    p_date: input.date,
    p_time: input.time,
    p_party: input.party,
    p_adults: input.adults,
    p_children: input.children,
    p_name: input.name,
    p_kana: input.kana,
    p_phone: input.phone,
    p_email: input.email,
    p_course_id: input.courseId,
    p_seat_type: input.seatType,
    p_purpose: input.purpose,
    p_allergy: input.allergy,
    p_request: request,
    p_source_code: input.sourceCode,
    p_consent: input.consent,
  });

  if (error) return { data: null, errorMessage: safePublicErrorCode(error.message, { route: 'booking:create_public_reservation' }) };
  const result = data as CreateReservationResult;

  // お店の端末（iPad・iPhone）へ「新しい予約」を知らせる（Web Push）。
  // 返事を待たせないよう、レスポンスを返したあとに送る。失敗しても予約は成立している。
  after(() => notifyStoreOfReservation(result.id));

  return { data: result, errorMessage: null };
}

/** 店舗（slug）の当店のクーポンの文。見つからなければ null */
async function couponLabelFor(slug: string, couponId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data: store } = await admin.from('stores').select('id').eq('slug', slug).maybeSingle();
    if (!store) return null;
    const { data } = await admin.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
    const coupon = bookingCouponsFrom(data?.settings ?? null).find((c) => c.id === couponId);
    return coupon ? couponLabel(coupon) : null;
  } catch {
    return null;
  }
}

async function notifyStoreOfReservation(reservationId: string) {
  try {
    const admin = createAdminClient();
    const { data: r } = await admin
      .from('reservations')
      .select('store_id, code, guest_name, party_size, start_at, created_via, stores(name)')
      .eq('id', reservationId)
      .maybeSingle();
    if (!r) return;
    const store = (Array.isArray(r.stores) ? r.stores[0] : r.stores) as { name: string } | null;
    await pushNewReservation(r.store_id, {
      storeName: store?.name ?? '',
      guestName: r.guest_name,
      partySize: r.party_size,
      startAt: r.start_at,
      code: r.code,
      createdVia: r.created_via,
    });
  } catch (e) {
    console.error('[booking] reservation notify failed', e instanceof Error ? e.message : e);
  }
}
