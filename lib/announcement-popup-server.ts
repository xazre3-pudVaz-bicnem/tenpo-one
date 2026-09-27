import type { createClient } from './supabase/server';
import { todayJst } from './format';
import { popupQueue, type PopupAnnouncement } from './announcement-popup';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** ポップアップに出す重要なお知らせ（公開期間内・この人がまだ了解していないもの。新しい順に最大5件） */
export async function loadPopupAnnouncements(
  supabase: Supabase,
  input: { organizationId: string; userId: string; storeIds: string[] }
): Promise<PopupAnnouncement[]> {
  const storeFilter =
    input.storeIds.length > 0 ? `store_id.is.null,store_id.in.(${input.storeIds.join(',')})` : 'store_id.is.null';
  const { data: rows } = await supabase
    .from('announcements')
    .select('id, title, body, publish_from, publish_to')
    .eq('organization_id', input.organizationId)
    .eq('is_important', true)
    .or(storeFilter)
    .order('created_at', { ascending: false })
    .limit(20);
  const list: PopupAnnouncement[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: r.body as string,
    publishFrom: (r.publish_from as string | null) ?? null,
    publishTo: (r.publish_to as string | null) ?? null,
  }));
  if (list.length === 0) return [];
  const { data: reads } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .eq('profile_id', input.userId)
    .in(
      'announcement_id',
      list.map((a) => a.id)
    );
  const readIds = new Set((reads ?? []).map((r) => r.announcement_id as string));
  return popupQueue(list, readIds, todayJst()).slice(0, 5);
}
