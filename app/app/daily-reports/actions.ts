'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { calcWasteAmount } from '@/lib/costing';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import type { Role } from '@/lib/permissions';

const PATH = '/app/daily-reports';

/** daily_reports の write RLS(org_owner/hq_admin/area_manager/store_manager/assistant_manager)と一致させる */
const WRITE_ROLES: Role[] = ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'];
/** 承認は本社寄りロールに限定する（RLS上はWRITE_ROLES全員が可能だが、アプリ側でさらに絞る） */
const APPROVE_ROLES: Role[] = ['org_owner', 'hq_admin', 'area_manager'];

async function requireDailyReportWriter(storeId: string) {
  const ctx = await requireMember();
  if (!WRITE_ROLES.includes(ctx.role)) throw new Error('権限がありません');
  if (!ctx.stores.some((s) => s.id === storeId)) throw new Error('担当外の店舗です');
  return ctx;
}

export interface DailyMetrics {
  sales: number;
  guests: number;
  avgSpend: number;
  cashDifference: number | null;
  closingExists: boolean;
  reservationsCount: number;
  cancelCount: number;
  wasteAmount: number;
  laborCost: number;
}

async function buildMetrics(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  storeId: string,
  businessDate: string
): Promise<DailyMetrics> {
  const [ordersRes, closingRes, reservationsRes, wasteRes, timeEntriesRes, payrollRulesRes] = await Promise.all([
    supabase.from('orders').select('total, guest_count, status').eq('store_id', storeId).eq('business_date', businessDate).in('status', ['paid', 'refunded']),
    supabase.from('daily_closings').select('cash_difference').eq('store_id', storeId).eq('business_date', businessDate).maybeSingle(),
    supabase.from('reservations').select('status').eq('store_id', storeId).eq('reserved_date', businessDate),
    supabase.from('stock_movements').select('quantity, unit_cost').eq('store_id', storeId).eq('movement_type', 'waste').eq('business_date', businessDate),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .eq('store_id', storeId)
      .eq('work_date', businessDate),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', organizationId)
      .eq('status', 'active'),
  ]);

  const orders = ordersRes.data ?? [];
  const paid = orders.filter((o) => o.status === 'paid');
  const sales = paid.reduce((a, o) => a + o.total, 0);
  const guests = paid.reduce((a, o) => a + o.guest_count, 0);
  const avgSpend = guests > 0 ? Math.floor(sales / guests) : 0;

  const reservations = reservationsRes.data ?? [];
  const cancelCount = reservations.filter((r) => r.status === 'cancelled' || r.status === 'no_show').length;

  const wasteAmount = calcWasteAmount((wasteRes.data ?? []).map((m) => ({ quantity: m.quantity, unitCost: m.unit_cost })));

  const laborResult = estimateLaborCost(
    (timeEntriesRes.data ?? []) as TimeEntryForLabor[],
    (payrollRulesRes.data ?? []) as PayrollRuleForLabor[]
  );

  return {
    sales,
    guests,
    avgSpend,
    cashDifference: closingRes.data ? closingRes.data.cash_difference : null,
    closingExists: !!closingRes.data,
    reservationsCount: reservations.length,
    cancelCount,
    wasteAmount,
    laborCost: laborResult.total,
  };
}

/** 当日集計をmetricsへスナップショットしてdaily_reportsをupsertする（承認済みは再生成不可） */
export async function generateDailyReport(storeId: string, businessDate: string) {
  const ctx = await requireDailyReportWriter(storeId);
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('daily_reports')
    .select('id, status')
    .eq('store_id', storeId)
    .eq('business_date', businessDate)
    .maybeSingle();
  if (existing?.status === 'approved') throw new Error('承認済みの日報は再生成できません');

  const metrics = await buildMetrics(supabase, ctx.organizationId, storeId, businessDate);

  if (existing) {
    const { error } = await supabase
      .from('daily_reports')
      .update({ metrics, status: 'draft', updated_by: ctx.userId })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('daily_reports').insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      business_date: businessDate,
      metrics,
      status: 'draft',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath(PATH);
}

/** コメントを追記して提出する（draft→submitted） */
export async function submitDailyReport(reportId: string, comment: string) {
  const ctx = await requireMember();
  const supabase = await createClient();
  const { data: report, error } = await supabase.from('daily_reports').select('id, store_id, status').eq('id', reportId).single();
  if (error || !report) throw new Error('日報が見つかりません');
  if (!WRITE_ROLES.includes(ctx.role) || !ctx.stores.some((s) => s.id === report.store_id)) throw new Error('権限がありません');
  if (report.status !== 'draft') throw new Error('下書き状態の日報のみ提出できます');

  const { error: updErr } = await supabase
    .from('daily_reports')
    .update({
      comment: comment.trim() || null,
      status: 'submitted',
      submitted_by: ctx.userId,
      submitted_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq('id', reportId);
  if (updErr) throw new Error(updErr.message);
  revalidatePath(PATH);
}

/** 本社が日報を承認する（submitted→approved・監査ログ） */
export async function approveDailyReport(reportId: string) {
  const ctx = await requireMember();
  if (!APPROVE_ROLES.includes(ctx.role)) throw new Error('権限がありません');
  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from('daily_reports')
    .select('id, organization_id, store_id, status')
    .eq('id', reportId)
    .single();
  if (error || !report) throw new Error('日報が見つかりません');
  if (!ctx.stores.some((s) => s.id === report.store_id)) throw new Error('担当外の店舗です');
  if (report.status !== 'submitted') throw new Error('提出済みの日報のみ承認できます');

  const { error: updErr } = await supabase
    .from('daily_reports')
    .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', reportId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: report.organization_id,
    p_store: report.store_id,
    p_action: 'daily_report.approve',
    p_target_table: 'daily_reports',
    p_target_id: reportId,
    p_before: { status: 'submitted' },
    p_after: { status: 'approved' },
    p_note: null,
  });
  revalidatePath(PATH);
}

export interface DailyReportDetail {
  id: string;
  storeId: string;
  storeName: string;
  businessDate: string;
  status: string;
  metrics: DailyMetrics;
  comment: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

/** 日報詳細（担当店舗のみ閲覧可） */
export async function getDailyReportDetail(reportId: string): Promise<DailyReportDetail> {
  const ctx = await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('daily_reports')
    .select('id, store_id, business_date, status, metrics, comment, submitted_at, approved_at, stores(name)')
    .eq('id', reportId)
    .single();
  if (error || !data) throw new Error('日報が見つかりません');
  if (!ctx.stores.some((s) => s.id === data.store_id)) throw new Error('担当外の店舗です');

  const store = data.stores as unknown as { name: string } | null;
  return {
    id: data.id,
    storeId: data.store_id,
    storeName: store?.name ?? '不明な店舗',
    businessDate: data.business_date,
    status: data.status,
    metrics: data.metrics as unknown as DailyMetrics,
    comment: data.comment,
    submittedAt: data.submitted_at,
    approvedAt: data.approved_at,
  };
}
