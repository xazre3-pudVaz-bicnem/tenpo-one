import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { notificationTypeLabel } from '@/app/app/notifications/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 通知（GET ?part=notices）。Web の /app/notifications と同じ：自分宛・新しい順・最新100件、種別・店舗・状態で絞込 */
export interface NativeNoticesPayload {
  stores: { id: string; name: string }[];
  typeOptions: { key: string; label: string }[];
  type: string;
  store: string;
  status: string;
  items: { id: string; type: string; typeLabel: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[];
}

export async function loadNativeNotices(ctx: SessionContext, supabase: Supabase, q: { type: string; store: string; status: string }): Promise<NativeNoticesPayload> {
  let query = supabase.from('notifications').select('id, type, title, body, link, read_at, created_at, store_id').eq('recipient_id', ctx.userId);
  if (q.type) query = query.eq('type', q.type);
  if (q.store) query = query.eq('store_id', q.store);
  if (q.status === 'unread') query = query.is('read_at', null);
  if (q.status === 'read') query = query.not('read_at', 'is', null);
  const [{ data }, { data: allTypeRows }] = await Promise.all([
    query.order('created_at', { ascending: false }).limit(100),
    supabase.from('notifications').select('type').eq('recipient_id', ctx.userId).limit(1000),
  ]);
  const typeKeys = [...new Set((allTypeRows ?? []).map((r) => r.type as string))].sort((a, b) => notificationTypeLabel(a).localeCompare(notificationTypeLabel(b), 'ja'));
  return {
    stores: ctx.stores.map((s) => ({ id: s.id, name: s.name })),
    typeOptions: typeKeys.map((k) => ({ key: k, label: notificationTypeLabel(k) })),
    type: q.type,
    store: q.store,
    status: q.status,
    items: (data ?? []).map((n) => ({
      id: n.id as string,
      type: n.type as string,
      typeLabel: notificationTypeLabel(n.type as string),
      title: n.title as string,
      body: n.body as string | null,
      link: n.link as string | null,
      readAt: n.read_at as string | null,
      createdAt: n.created_at as string,
    })),
  };
}
