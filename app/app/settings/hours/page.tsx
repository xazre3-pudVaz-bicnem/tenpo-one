import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { BusinessHoursForm } from '@/components/settings/business-hours-form';
import { HolidaysPanel } from '@/components/settings/holidays-panel';
import type { BusinessHourInput } from './actions';

export const metadata: Metadata = { title: '営業時間・休業日 | 設定' };

export default async function HoursSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="営業時間・休業日" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: hours } = await supabase
    .from('business_hours')
    .select('day_of_week, is_closed, open_time, close_time, last_entry_time')
    .eq('store_id', targetStore.id);

  const byDay = new Map((hours ?? []).map((h) => [h.day_of_week, h]));
  const initialHours: BusinessHourInput[] = Array.from({ length: 7 }, (_, day) => {
    const h = byDay.get(day);
    return {
      dayOfWeek: day,
      isClosed: h?.is_closed ?? false,
      openTime: h?.open_time?.slice(0, 5) ?? null,
      closeTime: h?.close_time?.slice(0, 5) ?? null,
      lastEntryTime: h?.last_entry_time?.slice(0, 5) ?? null,
    };
  });

  const { data: holidays } = await supabase
    .from('holidays')
    .select('id, holiday_date, name, is_temporary')
    .eq('store_id', targetStore.id)
    .gte('holiday_date', todayJst())
    .order('holiday_date', { ascending: true });

  const initialHolidays = (holidays ?? []).map((h) => ({
    id: h.id,
    holidayDate: h.holiday_date,
    name: h.name,
    isTemporary: h.is_temporary,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="営業時間・休業日" description={targetStore.name} />

      <div className="space-y-5">
        <BusinessHoursForm storeId={targetStore.id} initial={initialHours} />
        <HolidaysPanel storeId={targetStore.id} initial={initialHolidays} />
      </div>
    </div>
  );
}
