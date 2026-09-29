import { createClient } from '@/lib/supabase/server';
import { loadStoreDay } from '@/lib/register-day-server';
import { dayBannerKind, jstHour } from '@/lib/register-day';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import { closeReminderText, topClerkName } from '@/lib/register-close-reminder';
import { RegisterClosePopup } from './register-close-popup';

/**
 * レジクローズを忘れた店のレジ（iPad）に、次の日ポップアップを出す（2026-09-30 Ronnie）。
 * あて先はその営業日にいちばん多く会計した担当者。出す条件は上の帯（RegisterDayBanner）と同じ。
 */
export async function RegisterCloseReminder({ storeId }: { storeId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const day = await loadStoreDay(supabase, storeId, now);
  const kind = dayBannerKind(day, jstHour(now));
  if (!kind) return null;
  const date = kind === 'stale' ? (day.oldestOpen ?? day.clock) : day.businessDate;

  const [{ data: orders }, { data: sessions }] = await Promise.all([
    supabase
      .from('orders')
      .select('clerk_name')
      .eq('store_id', storeId)
      .eq('business_date', date)
      .in('status', SETTLED_ORDER_STATUSES)
      .not('clerk_name', 'is', null)
      .limit(1000),
    supabase
      .from('register_sessions')
      .select('opened_clerk_name')
      .eq('store_id', storeId)
      .eq('status', 'open')
      .eq('business_date', date)
      .limit(5),
  ]);
  const top =
    topClerkName((orders ?? []).map((o) => o.clerk_name as string | null)) ??
    topClerkName((sessions ?? []).map((s) => (s as { opened_clerk_name?: string | null }).opened_clerk_name ?? null));
  const text = closeReminderText(kind, date, top?.name ?? null);

  return <RegisterClosePopup storeId={storeId} date={date} title={text.title} body={text.body} />;
}
