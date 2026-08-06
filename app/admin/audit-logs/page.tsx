import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';

export const metadata: Metadata = { title: '監査ログ' };

interface AuditLogRow {
  id: string;
  organization_id: string | null;
  store_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  before_data: unknown;
  after_data: unknown;
  note: string | null;
  created_at: string;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; from?: string; to?: string; action?: string }>;
}) {
  await requireCypressAdmin();
  const { org, from, to, action } = await searchParams;
  const admin = createAdminClient();

  const { data: organizations } = await admin.from('organizations').select('id, name').order('name');
  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));

  let query = admin
    .from('audit_logs')
    .select('id, organization_id, store_id, actor_id, actor_role, action, target_table, target_id, before_data, after_data, note, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (org) query = query.eq('organization_id', org);
  if (action) query = query.ilike('action', `%${action}%`);
  if (from) query = query.gte('created_at', `${from}T00:00:00+09:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59+09:00`);

  const { data } = await query;
  const rows = (data ?? []) as AuditLogRow[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))];
  let actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, display_name').in('id', actorIds);
    actorNameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  }

  return (
    <div>
      <PageHeader title="監査ログ" description="全企業を横断して重要操作の履歴を確認できます（新しい順・最大100件）。" />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Select name="org" defaultValue={org ?? ''} className="w-full sm:w-52">
          <option value="">すべての企業</option>
          {(organizations ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={from ?? ''} className="w-full sm:w-40" />
        <Input type="date" name="to" defaultValue={to ?? ''} className="w-full sm:w-40" />
        <Input name="action" defaultValue={action ?? ''} placeholder="操作名で検索（部分一致）" className="w-full sm:w-56" />
        <Button type="submit" variant="secondary">絞り込む</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="該当する監査ログがありません" description="検索条件を変更してお試しください" />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <details key={r.id} className="rounded-xl border border-gray-200 bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="w-40 shrink-0 text-xs text-gray-500">{formatDateTime(r.created_at)}</span>
                <Badge tone="primary">{r.action}</Badge>
                <span className="text-xs text-gray-500">
                  {r.organization_id ? (orgNameById.get(r.organization_id) ?? r.organization_id) : '—'}
                </span>
                <span className="text-xs text-gray-400">
                  {r.target_table ?? '—'}
                  {r.target_id ? `#${r.target_id.slice(0, 8)}` : ''}
                </span>
                <span className="ml-auto text-xs font-medium text-navy">
                  {r.actor_id ? (actorNameById.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : 'システム'}
                  {r.actor_role ? `（${r.actor_role}）` : ''}
                </span>
              </summary>
              <div className="border-t border-gray-100 px-4 py-3">
                {r.note && <p className="mb-3 text-sm text-gray-700">メモ: {r.note}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">変更前</p>
                    <pre className="overflow-x-auto rounded-lg bg-surface p-3 text-[11px] text-gray-700">
                      {JSON.stringify(r.before_data ?? null, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">変更後</p>
                    <pre className="overflow-x-auto rounded-lg bg-surface p-3 text-[11px] text-gray-700">
                      {JSON.stringify(r.after_data ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
