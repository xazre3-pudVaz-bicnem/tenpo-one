import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isHqRole, ROLE_LABELS, type Role } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th } from '@/components/ui/table';
import { SettingsBackLink } from '@/components/settings/back-link';
import { AuditFilters } from '@/components/settings/audit-filters';
import { AuditRow, type AuditLogRow } from '@/components/settings/audit-row';

export const metadata: Metadata = { title: '監査ログ | 設定' };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; action?: string; table?: string }>;
}) {
  const ctx = await requirePermission('audit.view');
  const { from, to, action, table } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, target_table, target_id, before_data, after_data, note, created_at, store_id')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!isHqRole(ctx.role)) {
    const storeIds = ctx.stores.map((s) => s.id);
    query = storeIds.length > 0 ? query.in('store_id', storeIds) : query.eq('store_id', '00000000-0000-0000-0000-000000000000');
  }
  if (from) query = query.gte('created_at', `${from}T00:00:00+09:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59+09:00`);
  if (action) query = query.ilike('action', `%${action}%`);
  if (table) query = query.eq('target_table', table);

  const { data: logs } = await query;
  const rows = logs ?? [];

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id)));
  let actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabase.from('profiles').select('id, display_name').in('id', actorIds);
    actorNames = new Map((actors ?? []).map((a) => [a.id, a.display_name]));
  }

  const displayRows: AuditLogRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    actorName: r.actor_id ? (actorNames.get(r.actor_id) ?? '不明なユーザー') : 'システム',
    actorRole: r.actor_role ? (ROLE_LABELS[r.actor_role as Role] ?? r.actor_role) : null,
    action: r.action,
    targetTable: r.target_table,
    targetId: r.target_id,
    beforeData: r.before_data,
    afterData: r.after_data,
    note: r.note,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="監査ログ" description="権限変更・停止・設定変更などの操作履歴（新しい順・最大100件）" />

      <AuditFilters current={{ from: from ?? '', to: to ?? '', action: action ?? '', targetTable: table ?? '' }} />

      {displayRows.length === 0 ? (
        <EmptyState title="該当する操作履歴がありません" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>日時</Th>
                <Th>操作者</Th>
                <Th>アクション</Th>
                <Th>対象テーブル</Th>
                <Th>対象ID</Th>
              </Tr>
            </THead>
            <TBody>
              {displayRows.map((r) => (
                <AuditRow key={r.id} row={r} />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
