'use server';

import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  deviceLabelFrom,
  pushSubscriptionsFrom,
  removePushSubscription,
  upsertPushSubscription,
} from '@/lib/push-subscriptions';
import { vapidConfigured } from '@/lib/push-server';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function validSubscription(v: PushSubscriptionInput | null | undefined): v is PushSubscriptionInput {
  return (
    !!v &&
    typeof v.endpoint === 'string' &&
    v.endpoint.startsWith('https://') &&
    v.endpoint.length < 2048 &&
    !!v.keys &&
    typeof v.keys.p256dh === 'string' &&
    typeof v.keys.auth === 'string' &&
    v.keys.p256dh.length < 512 &&
    v.keys.auth.length < 512
  );
}

/**
 * この端末を「予約の通知」の送り先として店舗に登録する。
 * ログインしていれば役職を問わず登録できる（レジ iPad・ハンディ iPhone・アルバイト端末も）。
 * store_settings の RLS は店長以上なので、所属を確認したうえで service role で書く。
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<{ error?: string; label?: string | null }> {
  const ctx = await requireSession();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { error: '店舗が選ばれていません' };
  if (!vapidConfigured()) return { error: '通知の鍵（VAPID）がサーバーに設定されていません' };
  if (!validSubscription(input)) return { error: '通知の登録情報が正しくありません' };

  const label = deviceLabelFrom((await headers()).get('user-agent'));
  const admin = createAdminClient();
  const { data: existing } = await admin.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
  const current = ((existing?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const next = upsertPushSubscription(pushSubscriptionsFrom(current), {
    endpoint: input.endpoint,
    keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
    label,
    createdAt: new Date().toISOString(),
  });

  const { error } = await admin.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: store.id,
      settings: { ...current, pushSubscriptions: next },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `通知の登録に失敗しました: ${error.message}` };
  return { label };
}

/** この端末を通知の送り先から外す */
export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const ctx = await requireSession();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { error: '店舗が選ばれていません' };
  if (typeof endpoint !== 'string' || !endpoint) return {};

  const admin = createAdminClient();
  const { data: existing } = await admin.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
  const current = ((existing?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const list = pushSubscriptionsFrom(current);
  if (!list.some((s) => s.endpoint === endpoint)) return {};

  const { error } = await admin
    .from('store_settings')
    .update({ settings: { ...current, pushSubscriptions: removePushSubscription(list, endpoint) }, updated_by: ctx.userId })
    .eq('store_id', store.id);
  if (error) return { error: `通知の解除に失敗しました: ${error.message}` };
  return {};
}

/** 通知の登録状況（設定画面の表示用） */
export async function listPushSubscriptions(): Promise<{ count: number; labels: string[] }> {
  const ctx = await requireSession();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { count: 0, labels: [] };
  const admin = createAdminClient();
  const { data } = await admin.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
  const list = pushSubscriptionsFrom((data?.settings as Record<string, unknown> | null) ?? {});
  return { count: list.length, labels: list.map((s) => s.label ?? '端末') };
}
