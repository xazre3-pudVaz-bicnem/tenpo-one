import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PayrollItemView } from '@/components/payroll/breakdown-panel';
import type { BonusItemView } from '@/components/payroll/bonus-items-table';
import type { PayslipData } from '@/components/payroll/payslip';
import type { NenchoStatus } from '@/components/payroll/nencho-form';
import type { NenchoAdminRow } from '@/components/payroll/nencho-admin-panel';
import type { RulesSnapshot } from '@/components/payroll/rules-snapshot-panel';
import { emptyNenchoData, type NenchoData } from '@/app/app/payroll/nencho/schema';

/**
 * 給与・歩合（/app/payroll・/app/payroll/[runId]・/app/payroll/nencho）の読み込み。
 * Web のページと iPad ネイティブ（lib/native-modules/payroll.ts）で同じ読み込みを使う
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface PayrollOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------
// 一覧（/app/payroll）
// ---------------------------------------------------------------

/** 在籍スタッフ（名前順）。給与ルール・歩合ルール・賞与の対象の選択肢 */
export async function loadPayrollStaffOptions(supabase: Supabase, organizationId: string): Promise<PayrollOption[]> {
  const { data: memberRows } = await supabase
    .from('memberships')
    .select('profile_id, profiles(id, display_name)')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  return (memberRows ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { id: string; display_name: string } | null;
      return p ? { id: p.id, name: p.display_name } : null;
    })
    .filter((s): s is PayrollOption => !!s)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 有効な給与ルール・歩合ルール（新しい順） */
export async function loadPayrollRuleLists(supabase: Supabase, organizationId: string) {
  // 給与ルール(rules)と歩合ルール(commissionRules)は独立のため並列取得する。
  const [{ data: rules }, { data: commissionRules }] = await Promise.all([
    supabase
      .from('payroll_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    supabase
      .from('commission_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ]);
  return { rules: rules ?? [], commissionRules: commissionRules ?? [] };
}

/** 給与計算（run）の一覧（期間の新しい順） */
export async function loadPayrollRuns(supabase: Supabase, organizationId: string) {
  const { data: runs } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('period_start', { ascending: false });
  return runs ?? [];
}

export interface MyPayslipRun {
  id: string;
  title: string;
  run_type: string;
  period_start: string;
  period_end: string;
  payment_date: string | null;
  status: string;
}

/**
 * 本人ビュー: 給与明細一覧（サマリーカード）。
 * payroll_runs は payroll.view_all ロールのみ閲覧可能な RLS のため、本人が payroll_items を
 * 保有していること（RLS: profile_id = auth.uid()）を先に確認したうえで、
 * admin client により表示用の非機密フィールドのみを取得する（実データの露出は自分の分のみ）。
 */
export async function loadMyPayslips(supabase: Supabase, ctx: { userId: string; organizationId: string }) {
  const { data: items } = await supabase
    .from('payroll_items')
    .select('id, payroll_run_id, gross_total, breakdown')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .order('created_at', { ascending: false });

  const myItems = items ?? [];
  const runIds = [...new Set(myItems.map((i) => i.payroll_run_id as string))];

  let runs: MyPayslipRun[] = [];
  if (runIds.length > 0) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('payroll_runs')
      .select('id, title, run_type, period_start, period_end, payment_date, status')
      .eq('organization_id', ctx.organizationId)
      .in('id', runIds)
      .in('status', ['confirmed', 'approved'])
      .order('period_start', { ascending: false });
    runs = data ?? [];
  }

  const itemByRunId = new Map(myItems.map((i) => [i.payroll_run_id as string, i]));
  return { runs, itemByRunId };
}

// ---------------------------------------------------------------
// 詳細（/app/payroll/[runId]）
// ---------------------------------------------------------------

/** payroll_runs の行（詳細で使う列） */
export interface PayrollRunRow {
  id: string;
  title: string;
  run_type: string | null;
  status: 'draft' | 'confirmed' | 'approved';
  period_start: string;
  period_end: string;
  payment_date: string | null;
  store_id: string | null;
  note: string | null;
  rules_snapshot: RulesSnapshot | null;
}

export type PayrollRunDetail =
  /** 本人ビュー: 自分の明細が無い */
  | { kind: 'self-missing' }
  /** 本人ビュー: 確定前 */
  | { kind: 'self-not-ready' }
  | { kind: 'self'; payslip: PayslipData }
  /** 管理ビュー: run が無い（Web は notFound()） */
  | { kind: 'not-found' }
  | {
      kind: 'manage';
      run: PayrollRunRow;
      runType: 'salary' | 'bonus';
      storeName: string | null;
      views: PayrollItemView[];
      bonusViews: BonusItemView[];
      nameByProfile: Map<string, string>;
    };

/** 管理者は全明細を、一般スタッフは自分の明細のみ閲覧できる */
export async function loadPayrollRunDetail(
  supabase: Supabase,
  ctx: { userId: string; organizationId: string; displayName: string; organizationName: string | null },
  runId: string,
  canManage: boolean
): Promise<PayrollRunDetail> {
  // ---------------------------------------------------------------
  // 本人ビュー: payroll_runs は payroll.view_all ロールのみが読める RLS のため、
  // 先に本人所有の payroll_items（RLS: profile_id = auth.uid()）で権限を確認してから、
  // admin client で run の表示用フィールド（非機密）のみを取得する。
  // ---------------------------------------------------------------
  if (!canManage) {
    const { data: item } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_run_id', runId)
      .eq('organization_id', ctx.organizationId)
      .eq('profile_id', ctx.userId)
      .maybeSingle();

    if (!item) return { kind: 'self-missing' };

    const admin = createAdminClient();
    const { data: run } = await admin
      .from('payroll_runs')
      .select('id, title, run_type, period_start, period_end, payment_date, status')
      .eq('id', runId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (!run || (run.status !== 'confirmed' && run.status !== 'approved')) return { kind: 'self-not-ready' };

    const runType = (run.run_type ?? 'salary') as 'salary' | 'bonus';
    const payslip: PayslipData = {
      runTitle: run.title,
      runType,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      paymentDate: run.payment_date,
      profileName: ctx.displayName,
      organizationName: ctx.organizationName,
      workDays: item.work_days,
      workMinutes: item.work_minutes,
      overtimeMinutes: item.overtime_minutes,
      nightMinutes: item.night_minutes,
      holidayMinutes: item.holiday_minutes,
      basePay: item.base_pay,
      overtimePay: item.overtime_pay,
      nightPay: item.night_pay,
      holidayPay: item.holiday_pay,
      commutePay: item.commute_pay,
      allowanceTotal: item.allowance_total,
      commissionTotal: item.commission_total,
      grossTotal: item.gross_total,
    };
    return { kind: 'self', payslip };
  }

  // ---------------------------------------------------------------
  // 管理ビュー（payroll.manage）
  // ---------------------------------------------------------------
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!run) return { kind: 'not-found' };

  const runType = (run.run_type ?? 'salary') as 'salary' | 'bonus';

  const { data: storeRow } = run.store_id
    ? await supabase.from('stores').select('name').eq('id', run.store_id).maybeSingle()
    : { data: null };

  const { data: items } = await supabase
    .from('payroll_items')
    .select('*, profiles(display_name)')
    .eq('payroll_run_id', runId)
    .order('created_at');

  const nameByProfile = new Map(
    (items ?? []).map((row) => [row.profile_id as string, (row.profiles as unknown as { display_name: string } | null)?.display_name ?? '不明'])
  );

  const views: PayrollItemView[] = (items ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    return {
      id: row.id,
      profileName: profile?.display_name ?? '不明',
      workDays: row.work_days,
      workMinutes: row.work_minutes,
      overtimeMinutes: row.overtime_minutes,
      nightMinutes: row.night_minutes,
      holidayMinutes: row.holiday_minutes,
      basePay: row.base_pay,
      overtimePay: row.overtime_pay,
      nightPay: row.night_pay,
      holidayPay: row.holiday_pay,
      commutePay: row.commute_pay,
      allowanceTotal: row.allowance_total,
      commissionTotal: row.commission_total,
      grossTotal: row.gross_total,
      breakdown: row.breakdown as PayrollItemView['breakdown'],
    };
  });

  const bonusViews: BonusItemView[] = (items ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    return { id: row.id, profileName: profile?.display_name ?? '不明', amount: row.gross_total };
  });

  return { kind: 'manage', run: run as PayrollRunRow, runType, storeName: (storeRow?.name as string | undefined) ?? null, views, bonusViews, nameByProfile };
}

// ---------------------------------------------------------------
// 年末調整（/app/payroll/nencho）
// ---------------------------------------------------------------

export const NENCHO_ADMIN_STATUSES = ['submitted', 'reviewing', 'needs_fix', 'confirmed'];

export function currentJstYear(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' }));
}

export interface NenchoPageData {
  year: number;
  ownStatus: NenchoStatus;
  ownData: NenchoData;
  ownReviewNote: string | null;
  adminRows: NenchoAdminRow[];
  yearOptions: number[];
}

/** 自分の申告と、確認する人（payroll.view_all）には提出状況の一覧 */
export async function loadNenchoPage(
  supabase: Supabase,
  ctx: { userId: string; organizationId: string },
  { year, status }: { year: number; status?: string },
  canReview: boolean
): Promise<NenchoPageData> {
  const { data: own } = await supabase
    .from('nencho_declarations')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('year', year)
    .maybeSingle();

  const ownStatus: NenchoStatus = (own?.status as NenchoStatus) ?? 'new';
  const ownData: NenchoData = (own?.data as NenchoData) ?? emptyNenchoData();

  let adminRows: NenchoAdminRow[] = [];
  if (canReview) {
    let query = supabase
      .from('nencho_declarations')
      .select('id, year, status, submitted_at, reviewed_at, review_note, data, profiles(display_name)')
      .eq('organization_id', ctx.organizationId)
      .eq('year', year)
      .neq('status', 'draft')
      .order('submitted_at', { ascending: false });
    if (status && NENCHO_ADMIN_STATUSES.includes(status)) {
      query = query.eq('status', status);
    }
    const { data } = await query;
    adminRows = (data ?? []).map((row) => {
      const profile = row.profiles as unknown as { display_name: string } | null;
      return {
        id: row.id as string,
        profileName: profile?.display_name ?? '不明',
        year: row.year as number,
        status: row.status as NenchoAdminRow['status'],
        submittedAt: row.submitted_at as string | null,
        reviewedAt: row.reviewed_at as string | null,
        reviewNote: row.review_note as string | null,
        data: row.data as NenchoData,
      };
    });
  }

  return {
    year,
    ownStatus,
    ownData,
    ownReviewNote: (own?.review_note as string | null | undefined) ?? null,
    adminRows,
    yearOptions: [year - 1, year, year + 1],
  };
}
