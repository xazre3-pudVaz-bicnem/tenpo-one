import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { CopyLink } from '@/components/settings/copy-link';
import { StoreForm, type StoreFormData } from '@/components/settings/store-form';

export const metadata: Metadata = { title: '店舗情報 | 設定' };

export default async function StoreSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="店舗情報" />
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
        <PageHeader title="店舗情報" />
        <EmptyState title="店舗情報を取得できませんでした" />
      </div>
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const bookingUrl = `${siteUrl}/book/${store.slug}`;

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
      <PageHeader title="店舗情報" description={store.name} />

      <div className="mb-5">
        <CopyLink url={bookingUrl} label="公開予約ページURL" />
      </div>

      <StoreForm initial={initial} />
    </div>
  );
}
