/**
 * ダッシュボード用の未読お知らせバナー（重要のみ）。
 * 公開期間内かつ未読の「重要」お知らせがあれば表示する。
 */
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import type { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function AnnouncementBanner({
  supabase,
  organizationId,
  userId,
  storeIds,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  storeIds: string[];
}) {
  const today = todayJst();
  const { data: rows } = await supabase
    .from('announcements')
    .select('id, title, publish_from, publish_to')
    .eq('organization_id', organizationId)
    .eq('is_important', true)
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null')
    .order('created_at', { ascending: false })
    .limit(20);

  const inPeriod = (a: { publish_from: string | null; publish_to: string | null }) => {
    if (a.publish_from && today < a.publish_from) return false;
    if (a.publish_to && today > a.publish_to) return false;
    return true;
  };
  const candidates = (rows ?? []).filter(inPeriod);
  if (candidates.length === 0) return null;

  const ids = candidates.map((c) => c.id);
  const { data: readRows } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .eq('profile_id', userId)
    .in('announcement_id', ids);
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id));
  const unread = candidates.filter((c) => !readSet.has(c.id));
  if (unread.length === 0) return null;

  return (
    <Link
      href="/app/announcements"
      className="mb-3 flex items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger hover:opacity-90"
    >
      <Megaphone className="h-4 w-4 shrink-0" />
      未読の重要なお知らせが{unread.length}件あります：{unread[0].title}
      {unread.length > 1 && ` 他${unread.length - 1}件`}
    </Link>
  );
}
