import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { SettingsBackLink } from '@/components/settings/back-link';
import { BookingSettingsForm } from '@/components/settings/booking-settings-form';
import { BookingUrlPanel } from '@/components/settings/booking-url-panel';
import { StoreSlugEditor } from '@/components/settings/store-slug-editor';

export const metadata: Metadata = { title: '予約設定 | 設定' };

export default async function BookingSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="予約設定" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: store }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('slug, booking_enabled').eq('id', targetStore.id).single(),
    supabase
      .from('store_settings')
      .select('slot_minutes, default_stay_minutes, booking_cutoff_minutes, booking_window_days, max_party_size, cancel_deadline_hours, cleaning_buffer_minutes, booking_photo_url, booking_notes, cancellation_policy')
      .eq('store_id', targetStore.id)
      .maybeSingle(),
  ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const bookingUrl = `${siteUrl}/book/${store?.slug ?? ''}`;

  // 公開予約URLのQRコード（掲出用）。data URLはCSP img-src data:許可で表示可。
  let qrDataUrl: string | null = null;
  if (store?.slug && siteUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(bookingUrl, { width: 320, margin: 1 });
    } catch {
      qrDataUrl = null;
    }
  }

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="予約設定"
        description={targetStore.name}
        actions={
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="sm">
              <ExternalLink className="h-4 w-4" />
              公開予約ページを確認
            </Button>
          </a>
        }
      />

      {!store?.booking_enabled && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          この店舗はオンライン予約が<strong>停止中</strong>です。受付を再開するには「店舗情報」設定で「オンライン予約を受け付ける」を有効にしてください。
        </div>
      )}

      {siteUrl ? (
        <div className="mb-5">
          <BookingUrlPanel
            url={bookingUrl}
            qrDataUrl={qrDataUrl}
            storeName={targetStore.name}
            slugEditor={
              store?.slug ? (
                <StoreSlugEditor storeId={targetStore.id} slug={store.slug} baseUrl={`${siteUrl}/book/`} />
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          公開URL・QRコードを表示するには、環境変数 <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> の設定が必要です。
        </div>
      )}

      <BookingSettingsForm
        initial={{
          storeId: targetStore.id,
          slotMinutes: settings?.slot_minutes ?? 30,
          defaultStayMinutes: settings?.default_stay_minutes ?? 120,
          bookingCutoffMinutes: settings?.booking_cutoff_minutes ?? 120,
          bookingWindowDays: settings?.booking_window_days ?? 90,
          maxPartySize: settings?.max_party_size ?? 12,
          cancelDeadlineHours: settings?.cancel_deadline_hours ?? 24,
          cleaningBufferMinutes: settings?.cleaning_buffer_minutes ?? 0,
          bookingPhotoUrl: settings?.booking_photo_url ?? '',
          bookingNotes: settings?.booking_notes ?? '',
          cancellationPolicy: settings?.cancellation_policy ?? '',
        }}
      />
    </div>
  );
}
