import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { SettingsBackLink } from '@/components/settings/back-link';
import { BookingSettingsForm } from '@/components/settings/booking-settings-form';

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
    supabase.from('stores').select('slug').eq('id', targetStore.id).single(),
    supabase
      .from('store_settings')
      .select('slot_minutes, default_stay_minutes, booking_cutoff_minutes, booking_window_days, max_party_size, cancel_deadline_hours')
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

      <BookingSettingsForm
        initial={{
          storeId: targetStore.id,
          slotMinutes: settings?.slot_minutes ?? 30,
          defaultStayMinutes: settings?.default_stay_minutes ?? 120,
          bookingCutoffMinutes: settings?.booking_cutoff_minutes ?? 120,
          bookingWindowDays: settings?.booking_window_days ?? 90,
          maxPartySize: settings?.max_party_size ?? 12,
          cancelDeadlineHours: settings?.cancel_deadline_hours ?? 24,
        }}
      />
    </div>
  );
}
