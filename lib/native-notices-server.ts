import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { notificationTypeLabel } from '@/app/app/notifications/labels';
import { todayJst } from '@/lib/format';

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

const ANN_WRITE_ROLES = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'];

/** お知らせ（GET ?part=announcements）。Web の /app/announcements と同じ並び（公開期間内 → 重要 → 新しい順） */
export interface NativeAnnouncementsPayload {
  canWrite: boolean;
  canTargetAllStores: boolean;
  targetStore: { id: string; name: string } | null;
  items: { id: string; title: string; body: string; isImportant: boolean; storeLabel: string; publishFrom: string | null; publishTo: string | null; createdAt: string; isRead: boolean; canDelete: boolean }[];
}

export async function loadNativeAnnouncements(ctx: SessionContext, supabase: Supabase): Promise<NativeAnnouncementsPayload> {
  const today = todayJst();
  const storeIds = ctx.stores.map((s) => s.id);
  const canWrite = ANN_WRITE_ROLES.includes(ctx.role ?? '');
  const { data: rows } = await supabase
    .from('announcements')
    .select('id, title, body, is_important, store_id, publish_from, publish_to, created_at, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null')
    .order('created_at', { ascending: false });
  const list = rows ?? [];
  const ids = list.map((a) => a.id as string);
  const { data: readRows } = ids.length
    ? await supabase.from('announcement_reads').select('announcement_id').eq('profile_id', ctx.userId).in('announcement_id', ids)
    : { data: [] as { announcement_id: string }[] };
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id as string));
  const inPeriod = (from: string | null, to: string | null) => !(from && today < from) && !(to && today > to);
  const sorted = [...list].sort((a, b) => {
    const ai = inPeriod(a.publish_from, a.publish_to);
    const bi = inPeriod(b.publish_from, b.publish_to);
    if (ai !== bi) return ai ? -1 : 1;
    if (a.is_important !== b.is_important) return a.is_important ? -1 : 1;
    return a.created_at < b.created_at ? 1 : -1;
  });
  const isHq = ctx.role === 'org_owner' || ctx.role === 'hq_admin';
  const target = ctx.currentStore ?? ctx.stores[0] ?? null;
  return {
    canWrite,
    canTargetAllStores: isHq,
    targetStore: canWrite && target ? { id: target.id, name: target.name } : null,
    items: sorted.map((a) => ({
      id: a.id as string,
      title: a.title as string,
      body: a.body as string,
      isImportant: a.is_important as boolean,
      storeLabel: a.store_id === null ? '全店舗' : ((a.stores as unknown as { name: string } | null)?.name ?? '店舗'),
      publishFrom: a.publish_from as string | null,
      publishTo: a.publish_to as string | null,
      createdAt: a.created_at as string,
      isRead: readSet.has(a.id as string),
      canDelete: canWrite && (a.store_id === null ? isHq : true),
    })),
  };
}
