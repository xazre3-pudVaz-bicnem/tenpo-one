'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { bookingCouponsFrom, bookingCouponsProblem, type BookingCoupon, type CouponUnit } from '@/lib/booking-coupons';

export interface CouponInput {
  id: string | null;
  title: string;
  value: number | null;
  unit: CouponUnit;
}

/**
 * 当店のクーポンを保存する（store_settings.settings.bookingCoupons。ほかの設定は消さない）。
 * 予約ページ・予約QRカード・店舗名刺に出る（lib/booking-coupons.ts）。
 */
export async function saveBookingCoupons(storeId: string, input: CouponInput[]): Promise<{ error?: string }> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  if (!Array.isArray(input)) return { error: 'クーポンが正しくありません' };

  const list: BookingCoupon[] = input.map((c) => {
    const raw = c?.value == null || (c.value as unknown) === '' ? null : Math.round(Number(c.value));
    return {
      id: typeof c?.id === 'string' && /^[a-z0-9]{4,24}$/.test(c.id) ? c.id : randomBytes(5).toString('hex'),
      title: String(c?.title ?? '').trim(),
      value: raw != null && Number.isFinite(raw) && raw > 0 ? raw : null,
      unit: c?.unit === 'yen' ? 'yen' : 'percent',
    };
  });
  const problem = bookingCouponsProblem(list);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data: existing } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const next = bookingCouponsFrom({ bookingCoupons: list });

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, bookingCoupons: next },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `クーポンを保存できませんでした: ${error.message}` };

  revalidatePath('/app/settings');
  revalidatePath('/app/settings/store');
  revalidatePath('/app/settings/store/business-cards');
  return {};
}
