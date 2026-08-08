'use server';

/**
 * 月次締めパネル（components/accounting/period-close-panel.tsx）専用の読み取り系サーバーアクション。
 * app/app/accounting/actions.ts（getPeriodStatus / closeMonth / reopenMonth）は他エージェント所有のため触れず、
 * 一覧・履歴表示に必要な追加データはこちらで補う。
 */

import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface PeriodOverviewRow {
  /** 'YYYY-MM' */
  month: string;
  status: 'open' | 'closed';
  draftCount: number;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
}

export interface PeriodAuditEntry {
  id: string;
  action: 'accounting.period_close' | 'accounting.period_reopen';
  createdAt: string;
  actorName: string | null;
  reason: string | null;
}

/** 'YYYY-MM' を１ヶ月進める */
function addMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** baseMonth('YYYY-MM')を最新として、過去count ヶ月分（baseMonth含む）を新しい順で返す */
function buildRecentMonths(baseMonth: string, count: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < count; i++) months.push(addMonth(baseMonth, -i));
  return months;
}

async function loadProfileNames(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', unique);
  for (const p of data ?? []) map.set(p.id as string, p.display_name as string);
  return map;
}

/** 直近count ヶ月（既定12）の締め状況一覧を取得する（各月の締め/解除の実行者名込み） */
export async function listPeriodOverview(baseMonth: string, count = 12): Promise<PeriodOverviewRow[]> {
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();

  const months = buildRecentMonths(baseMonth, count);
  const monthStarts = months.map((m) => `${m}-01`);
  const oldestStart = monthStarts[monthStarts.length - 1];
  const newestEnd = addMonth(months[0], 1) + '-01';

  const [{ data: periods }, { data: drafts }] = await Promise.all([
    supabase
      .from('accounting_periods')
      .select('month, status, closed_at, closed_by, reopened_at, reopened_by')
      .eq('organization_id', ctx.organizationId)
      .in('month', monthStarts),
    supabase
      .from('journal_entries')
      .select('entry_date')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'draft')
      .gte('entry_date', oldestStart)
      .lt('entry_date', newestEnd)
      .limit(20000),
  ]);

  const draftCountByMonth = new Map<string, number>();
  for (const d of drafts ?? []) {
    const key = (d.entry_date as string).slice(0, 7);
    draftCountByMonth.set(key, (draftCountByMonth.get(key) ?? 0) + 1);
  }

  const actorIds = (periods ?? []).flatMap((p) => [p.closed_by, p.reopened_by]).filter((v): v is string => !!v);
  const nameById = await loadProfileNames(supabase, actorIds);

  const periodByMonth = new Map((periods ?? []).map((p) => [(p.month as string).slice(0, 7), p]));

  return months.map((month) => {
    const p = periodByMonth.get(month);
    return {
      month,
      status: (p?.status as 'open' | 'closed' | undefined) ?? 'open',
      draftCount: draftCountByMonth.get(month) ?? 0,
      closedAt: (p?.closed_at as string | null) ?? null,
      closedByName: p?.closed_by ? (nameById.get(p.closed_by as string) ?? null) : null,
      reopenedAt: (p?.reopened_at as string | null) ?? null,
      reopenedByName: p?.reopened_by ? (nameById.get(p.reopened_by as string) ?? null) : null,
    };
  });
}

/** 指定月の締め/締め解除の操作履歴（audit_logs）を新しい順で取得する */
export async function getPeriodAuditHistory(month: string): Promise<PeriodAuditEntry[]> {
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();
  const monthStart = `${month}-01`;

  const { data } = await supabase
    .from('audit_logs')
    .select('id, action, created_at, actor_id, note')
    .eq('organization_id', ctx.organizationId)
    .eq('target_table', 'accounting_periods')
    .eq('target_id', monthStart)
    .in('action', ['accounting.period_close', 'accounting.period_reopen'])
    .order('created_at', { ascending: false })
    .limit(50);
  const rows = data ?? [];
  const nameById = await loadProfileNames(
    supabase,
    rows.map((r) => r.actor_id as string | null).filter((v): v is string => !!v)
  );
  return rows.map((r) => ({
    id: r.id as string,
    action: r.action as PeriodAuditEntry['action'],
    createdAt: r.created_at as string,
    actorName: r.actor_id ? (nameById.get(r.actor_id as string) ?? null) : null,
    reason: r.note as string | null,
  }));
}
