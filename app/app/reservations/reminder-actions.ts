'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { buildReservationReminder, isNotificationConfigured } from '@/lib/notifications';

export interface PrepareRemindersResult {
  enqueued: number;
  providerConnected: boolean;
  message: string;
}

/**
 * リマインダー対象の予約をアウトボックスへ積む（送信予定キュー化）。
 * 対象: 当該店舗の confirmed 予約で、まだリマインド未処理(reminder_sent_at is null)かつ
 *       開始が「今〜設定時間後」に入るもの。宛先はメール優先、無ければ電話(SMS)。
 * 実送信は外部プロバイダ未接続のため行わない（queued のまま。接続後に配送）。
 */
export async function prepareReservationReminders(storeId: string): Promise<PrepareRemindersResult> {
  const ctx = await requirePermission('reservations.write');
  if (!ctx.stores.some((s) => s.id === storeId)) throw new Error('この店舗へのアクセス権限がありません');
  const supabase = await createClient();

  const [{ data: store }, { data: settings }] = await Promise.all([
    supabase.from('stores').select('name, phone').eq('id', storeId).single(),
    supabase.from('store_settings').select('reminder_enabled, reminder_hours_before').eq('store_id', storeId).maybeSingle(),
  ]);
  if (!settings?.reminder_enabled) {
    return { enqueued: 0, providerConnected: isNotificationConfigured(), message: 'リマインダーが無効です（予約設定で有効化してください）。' };
  }
  const hours = settings.reminder_hours_before ?? 24;
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600 * 1000);

  const { data: reservations } = await supabase
    .from('reservations')
    .select('id, guest_name, guest_email, guest_phone, party_size, start_at, reserved_date, code, course_id, menu_items:course_id(name)')
    .eq('store_id', storeId)
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gt('start_at', now.toISOString())
    .lte('start_at', until.toISOString())
    .limit(500);

  let enqueued = 0;
  for (const r of reservations ?? []) {
    const channel = r.guest_email ? 'email' : r.guest_phone ? 'sms' : null;
    if (!channel) continue;
    const recipient = channel === 'email' ? r.guest_email! : r.guest_phone!;
    const time = new Date(r.start_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
    const courseName = (r.menu_items as unknown as { name: string } | null)?.name ?? null;
    const msg = buildReservationReminder({
      storeName: store?.name ?? '', storePhone: store?.phone ?? null,
      guestName: r.guest_name, date: r.reserved_date, time, partySize: r.party_size, courseName, code: r.code,
    });
    const { error } = await supabase.from('notification_outbox').insert({
      organization_id: ctx.organizationId, store_id: storeId, reservation_id: r.id,
      channel, recipient, subject: msg.subject, body: msg.body,
      status: 'queued', scheduled_for: now.toISOString(),
    });
    if (error) continue;
    await supabase.from('reservations').update({ reminder_sent_at: now.toISOString() }).eq('id', r.id);
    enqueued++;
  }

  revalidatePath('/app/settings/booking');
  const connected = isNotificationConfigured();
  return {
    enqueued,
    providerConnected: connected,
    message: connected
      ? `${enqueued}件のリマインダーを送信キューに追加しました。`
      : `${enqueued}件をキューに追加しました。※外部メール/SMSプロバイダ未接続のため実送信は行われません（接続後に配送されます）。`,
  };
}
