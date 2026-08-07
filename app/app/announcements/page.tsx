import type { Metadata } from 'next';
import { requirePermission, requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { AnnouncementForm } from './announcement-form';
import { AnnouncementItem, type AnnouncementItemData } from './announcement-item';

export const metadata: Metadata = { title: 'お知らせ' };

const WRITE_ROLES = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'];

export default async function AnnouncementsPage() {
  const ctx = await requirePermission('dashboard.view');
  const session = await requireSession();
  const supabase = await createClient();
  const today = todayJst();

  const storeIds = ctx.stores.map((s) => s.id);
  const canWrite = WRITE_ROLES.includes(ctx.role);

  const { data: rows } = await supabase
    .from('announcements')
    .select('id, title, body, is_important, store_id, publish_from, publish_to, created_at, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null')
    .order('created_at', { ascending: false });

  const announcements = rows ?? [];
  const announcementIds = announcements.map((a) => a.id);
  const { data: readRows } =
    announcementIds.length > 0
      ? await supabase.from('announcement_reads').select('announcement_id').eq('profile_id', session.userId).in('announcement_id', announcementIds)
      : { data: [] as { announcement_id: string }[] };
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id));

  function inPeriod(from: string | null, to: string | null): boolean {
    if (from && today < from) return false;
    if (to && today > to) return false;
    return true;
  }

  const sorted = [...announcements].sort((a, b) => {
    const aInPeriod = inPeriod(a.publish_from, a.publish_to);
    const bInPeriod = inPeriod(b.publish_from, b.publish_to);
    if (aInPeriod !== bInPeriod) return aInPeriod ? -1 : 1;
    if (a.is_important !== b.is_important) return a.is_important ? -1 : 1;
    return a.created_at < b.created_at ? 1 : -1;
  });

  const items: AnnouncementItemData[] = sorted.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    isImportant: a.is_important,
    storeLabel: a.store_id === null ? '全店舗' : ((a.stores as unknown as { name: string } | null)?.name ?? '店舗'),
    publishFrom: a.publish_from,
    publishTo: a.publish_to,
    createdAt: a.created_at,
    isRead: readSet.has(a.id),
    canDelete: canWrite && (a.store_id === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true),
  }));

  const targetStore = ctx.currentStore ?? ctx.stores[0];

  return (
    <div>
      <PageHeader
        title="お知らせ"
        description="本社・店舗からの連絡事項です（公開期間内が上位・重要は強調表示）"
        actions={canWrite && targetStore ? <AnnouncementForm storeId={targetStore.id} storeName={targetStore.name} canTargetAllStores={ctx.role === 'org_owner' || ctx.role === 'hq_admin'} /> : undefined}
      />

      {items.length === 0 ? (
        <EmptyState title="お知らせはありません" />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {items.map((item) => (
            <AnnouncementItem key={item.id} data={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
