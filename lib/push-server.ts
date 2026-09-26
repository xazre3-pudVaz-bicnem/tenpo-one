import 'server-only';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  pushSubscriptionsFrom,
  reservationPushPayload,
  type PushSubscriptionRecord,
  type ReservationNotice,
  type ReservationPushPayload,
} from '@/lib/push-subscriptions';

/**
 * Web Push の送信（サーバー専用）。
 *
 * 鍵は環境変数：
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  … 端末が購読するときに使う（公開してよい）
 *   VAPID_PRIVATE_KEY             … 送信時の署名（サーバーだけ）
 *   VAPID_SUBJECT                 … mailto: か https: の連絡先
 * 鍵が無ければ何も送らない（アプリの他の動きには影響させない）。
 */
export function vapidConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!vapidConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:support@tenpo-one.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    vapidReady = true;
  }
  return true;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  /** 死んでいた購読（404/410）を消した数 */
  removed: number;
}

/**
 * 店舗に登録された全端末へ送る。死んだ購読は store_settings から消す。
 * 例外は投げない（予約作成など本処理の成否に影響させない）。
 */
export async function sendPushToStore(storeId: string, payload: ReservationPushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
  if (!ensureVapid()) return result;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return result;
  }
  const { data } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const subs = pushSubscriptionsFrom(settings);
  if (subs.length === 0) return result;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s: PushSubscriptionRecord) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 60 * 60, urgency: 'high' });
        result.sent++;
      } catch (e) {
        result.failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.endpoint);
      }
    })
  );

  if (dead.length > 0) {
    const kept = subs.filter((s) => !dead.includes(s.endpoint));
    const { error } = await admin
      .from('store_settings')
      .update({ settings: { ...settings, pushSubscriptions: kept } })
      .eq('store_id', storeId);
    if (!error) result.removed = dead.length;
  }
  return result;
}

/** 新しい予約を店舗の端末へ知らせる（Web Push）。失敗しても投げない */
export async function pushNewReservation(storeId: string, notice: ReservationNotice): Promise<PushSendResult> {
  try {
    return await sendPushToStore(storeId, reservationPushPayload(notice));
  } catch (e) {
    console.error('[push] reservation push failed', storeId, e instanceof Error ? e.message : e);
    return { sent: 0, failed: 0, removed: 0 };
  }
}
