import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { NotificationRow } from './notification-row';
import { MarkAllReadButton } from './mark-all-button';

export const metadata: Metadata = { title: '通知' };

export default async function NotificationsPage() {
  const ctx = await requireSession();
  const supabase = await createClient();

  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('recipient_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  const notifications = data ?? [];
  const hasUnread = notifications.some((n) => !n.read_at);

  return (
    <div>
      <PageHeader
        title="通知"
        description="あなた宛の通知です（新しい順・最新50件）"
        actions={hasUnread ? <MarkAllReadButton /> : undefined}
      />
      {notifications.length === 0 ? (
        <EmptyState title="通知はありません" description="新しい予約や締め処理・承認待ちなどのお知らせがここに表示されます" />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {notifications.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </ul>
      )}
    </div>
  );
}
