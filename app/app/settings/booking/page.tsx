import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { ADMIN_ONLY_SETTINGS_NOTE } from '@/lib/admin-only-settings';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { SettingsBackLink } from '@/components/settings/back-link';
import { BookingSettingsForm } from '@/components/settings/booking-settings-form';

export const metadata: Metadata = { title: '予約設定 | 設定' };

export default async function BookingSettingsPage() {
  const ctx = await requirePermission('store.settings');
  // 予約受付ルール（予約枠・受付期間・公開予約ページの表示内容・リマインダー）は管理画面だけ（2026-09-29 Ronnie「管理画面」）
  if (ctx.isRegisterDevice) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="予約設定" en="Booking rules" />
        <EmptyState title="管理画面で変更してください" description={ADMIN_ONLY_SETTINGS_NOTE} />
      </div>
    );
  }
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="予約設定" en="Booking rules" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: store }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('slug, booking_enabled').eq('id', targetStore.id).single(),
    supabase
      .from('store_settings')
      .select('slot_minutes, default_stay_minutes, booking_cutoff_minutes, booking_window_days, max_party_size, cancel_deadline_hours, cleaning_buffer_minutes, booking_photo_url, booking_notes, cancellation_policy, reminder_enabled, reminder_hours_before, settings')
      .eq('store_id', targetStore.id)
      .maybeSingle(),
  ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const bookingUrl = `${siteUrl}/book/${store?.slug ?? ''}`;

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="予約設定"
        en="Booking rules"
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

      {/* 公開予約ページ（URL・スラッグ・予約QR）は 店舗情報 に移した（2026-09-30 Ronnie「店舗情報に。予約受付ルールには要らない」） */}

      {/* 予約の通知・リマインダーの送信準備は 予約台帳設定 に移した（2026-09-28 Ronnie） */}

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
          reminderEnabled: settings?.reminder_enabled ?? false,
          reminderHoursBefore: settings?.reminder_hours_before ?? 24,
        }}
      />

    </div>
  );
}
