import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { BookingUrlPanel } from '@/components/settings/booking-url-panel';
import { StoreSlugEditor } from '@/components/settings/store-slug-editor';
import { SLUG_CHANGE_BY_CYPRESS_ONLY } from '@/lib/store-slug';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { tableQrDataUrl } from '@/lib/table-qr';
import { StoreForm, type StoreFormData } from '@/components/settings/store-form';

export const metadata: Metadata = { title: '店舗情報 | 設定' };

export default async function StoreSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="店舗情報" en="Store" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: store } = await supabase
    .from('stores')
    .select('id, slug, name, name_kana, postal_code, address, phone, email, description, seat_count, booking_enabled')
    .eq('id', targetStore.id)
    .single();

  const { data: settings } = await supabase
    .from('store_settings')
    .select('receipt_header, receipt_footer, invoice_registration_number, service_charge_rate, rounding, allow_negative_stock')
    .eq('store_id', targetStore.id)
    .maybeSingle();

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="店舗情報" en="Store" />
        <EmptyState title="店舗情報を取得できませんでした" />
      </div>
    );
  }

  // 公開予約ページ（URL・スラッグ・予約QR）。予約受付ルールから移した（2026-09-30 Ronnie「店舗情報に置いて」）
  const siteUrl = await resolveSiteOrigin();
  const bookingUrl = `${siteUrl}/book/${store.slug}`;
  const qrDataUrl = store.slug ? await tableQrDataUrl(bookingUrl, 600).catch(() => null) : null;
  const cardAddress = store.address ? `${store.postal_code ? `〒${store.postal_code} ` : ''}${store.address}` : null;

  const initial: StoreFormData = {
    storeId: store.id,
    name: store.name,
    nameKana: store.name_kana ?? '',
    postalCode: store.postal_code ?? '',
    address: store.address ?? '',
    phone: store.phone ?? '',
    email: store.email ?? '',
    description: store.description ?? '',
    seatCount: store.seat_count,
    bookingEnabled: store.booking_enabled,
    receiptHeader: settings?.receipt_header ?? '',
    receiptFooter: settings?.receipt_footer ?? '',
    invoiceRegistrationNumber: settings?.invoice_registration_number ?? '',
    serviceChargeRate: settings?.service_charge_rate ?? 0,
    rounding: settings?.rounding ?? 'floor',
    allowNegativeStock: settings?.allow_negative_stock ?? true,
  };

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="店舗情報" en="Store" description={store.name} />

      <div className="mb-5">
        <BookingUrlPanel
          url={bookingUrl}
          qrDataUrl={qrDataUrl}
          storeName={store.name}
          address={cardAddress}
          phone={store.phone}
          slugEditor={
            store.slug ? (
              ctx.isCypressAdmin ? (
                <StoreSlugEditor storeId={store.id} slug={store.slug} baseUrl={`${siteUrl}/book/`} />
              ) : (
                // 店舗・本部からは変えられない（2026-09-27 Ronnie「URL は CYPRESS からだけ」）
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-gray-500">スラッグ：</span>
                  <span className="font-mono font-medium text-navy">{store.slug}</span>
                  <span className="text-xs text-ink-3">{SLUG_CHANGE_BY_CYPRESS_ONLY}</span>
                </div>
              )
            ) : undefined
          }
        />
      </div>

      {/* レシート・インボイス設定はレジ（iPad）からは変えられない（2026-09-29 Ronnie「管理画面から」） */}
      <StoreForm initial={initial} receiptLocked={ctx.isRegisterDevice === true} />
    </div>
  );
}
