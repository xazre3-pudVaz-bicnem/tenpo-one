import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MarkAllReadButton } from './mark-all-button';
import { NotificationList } from './display-settings';
import { notificationTypeLabel } from './labels';

export const metadata: Metadata = { title: '通知' };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; store?: string; status?: string }>;
}) {
  const ctx = await requireSession();
  const supabase = await createClient();
  const sp = await searchParams;

  let query = supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at, store_id')
    .eq('recipient_id', ctx.userId);
  if (sp.type) query = query.eq('type', sp.type);
  if (sp.store) query = query.eq('store_id', sp.store);
  if (sp.status === 'unread') query = query.is('read_at', null);
  if (sp.status === 'read') query = query.not('read_at', 'is', null);
  const { data } = await query.order('created_at', { ascending: false }).limit(100);

  const notifications = data ?? [];
  const hasUnread = notifications.some((n) => !n.read_at);

  // 絞込の選択肢は「自分宛の全通知」から動的に集計する（種別マスタが未整備のため）
  const { data: allTypeRows } = await supabase.from('notifications').select('type').eq('recipient_id', ctx.userId).limit(1000);
  const typeOptions = [...new Set((allTypeRows ?? []).map((r) => r.type))].sort((a, b) => notificationTypeLabel(a).localeCompare(notificationTypeLabel(b), 'ja'));

  return (
    <div>
      <PageHeader
        title="通知"
        description="あなた宛の通知です（新しい順・最新100件）"
        actions={hasUnread ? <MarkAllReadButton /> : undefined}
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        {typeOptions.length > 1 && (
          <div>
            <Label htmlFor="type">種別</Label>
            <Select id="type" name="type" defaultValue={sp.type ?? ''} className="w-36">
              <option value="">すべて</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {notificationTypeLabel(t)}
                </option>
              ))}
            </Select>
          </div>
        )}
        {ctx.stores.length > 1 && (
          <div>
            <Label htmlFor="store">店舗</Label>
            <Select id="store" name="store" defaultValue={sp.store ?? ''} className="w-40">
              <option value="">すべて</option>
              {ctx.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="status">状態</Label>
          <Select id="status" name="status" defaultValue={sp.status ?? ''} className="w-32">
            <option value="">すべて</option>
            <option value="unread">未読</option>
            <option value="read">既読</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          絞り込む
        </Button>
      </form>

      <NotificationList notifications={notifications} typeOptions={typeOptions} />
    </div>
  );
}
