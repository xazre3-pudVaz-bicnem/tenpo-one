import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { bookingCouponsFrom, couponLabel } from '@/lib/booking-coupons';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 店舗名刺（予約QRカード）に載せる中身 */
export interface StoreBusinessCard {
  storeName: string;
  /** 〒 付きの住所（無ければ null） */
  address: string | null;
  phone: string | null;
  /** 予約ページの URL（QR の中身）。スラッグが無ければ null */
  bookingUrl: string | null;
  /** 当店のクーポン（表示する文。名刺はいちばん上の1つだけ使う） */
  coupons: string[];
}

/**
 * 店舗名刺（設定 > 店舗情報 > 店舗名刺）の中身。Web の /app/settings/store/business-cards と
 * iPad ネイティブ（lib/native-modules/business-cards.ts）で同じ読み込み（2026-10-24 Ronnie「iPad は全部ネイティブ」で page.tsx から移した）。
 * 店舗が見つからなければ null
 */
export async function loadStoreBusinessCard(supabase: Supabase, storeId: string): Promise<StoreBusinessCard | null> {
  const [{ data: store }, { data: storeSettings }] = await Promise.all([
    supabase.from('stores').select('name, slug, postal_code, address, phone').eq('id', storeId).maybeSingle(),
    supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle(),
  ]);
  if (!store) return null;
  const coupons = bookingCouponsFrom(storeSettings?.settings ?? null).map(couponLabel);
  const bookingUrl = store.slug ? `${await resolveSiteOrigin()}/book/${store.slug}` : null;
  const address = store.address ? `${store.postal_code ? `〒${store.postal_code} ` : ''}${store.address}` : null;
  return { storeName: store.name, address, phone: store.phone ?? null, bookingUrl, coupons };
}
