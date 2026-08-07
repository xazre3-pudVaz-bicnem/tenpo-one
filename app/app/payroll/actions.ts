'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { calcPayroll, calcCommission, summarizeEntry, type DayAttendance } from '@/lib/payroll';
import { formatTime, formatMinutes } from '@/lib/format';

type ActionResult = { ok: boolean; message: string };

// ---------------------------------------------------------------
// 給与ルール
// ---------------------------------------------------------------

export interface AllowanceInput {
  name: string;
  amount: number;
  per: 'month' | 'day';
}

export interface PayrollRuleInput {
  id?: string;
  profileId: string;
  storeId: string | null;
  payType: 'monthly' | 'hourly' | 'daily';
  baseAmount: number;
  overtimeRate: number;
  nightRate: number;
  holidayRate: number;
  commuteAllowance: number;
  allowances: AllowanceInput[];
  closingDay: number;
  paymentDay: number;
  effectiveFrom: string;
}

export async function savePayrollRule(input: PayrollRuleInput): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  if (!input.profileId) return { ok: false, message: '対象スタッフを選択してください' };
  if (input.baseAmount < 0) return { ok: false, message: '基本額は0以上で入力してください' };

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    profile_id: input.profileId,
    store_id: input.storeId,
    pay_type: input.payType,
    base_amount: Math.round(input.baseAmount),
    overtime_rate: input.overtimeRate,
    night_rate: input.nightRate,
    holiday_rate: input.holidayRate,
    commute_allowance: Math.round(input.commuteAllowance),
    allowances: input.allowances,
    closing_day: input.closingDay,
    payment_day: input.paymentDay,
    effective_from: input.effectiveFrom,
    updated_by: ctx.userId,
  };

  const { error } = input.id
    ? await supabase.from('payroll_rules').update(payload).eq('id', input.id)
    : await supabase.from('payroll_rules').insert({ ...payload, created_by: ctx.userId });

  if (error) return { ok: false, message: '給与ルールの保存に失敗しました' };
  revalidatePath('/app/payroll');
  return { ok: true, message: '給与ルールを保存しました' };
}

// ---------------------------------------------------------------
// 歩合ルール
// ---------------------------------------------------------------

export interface TierInput {
  from: number;
  to: number | null;
  rate: number;
}

export interface CommissionRuleInput {
  id?: string;
  name: string;
  targetType: 'personal_sales' | 'store_target';
  profileId: string | null;
  storeId: string | null;
  method: 'fixed' | 'rate' | 'tiered';
  rate: number | null;
  fixedAmount: number | null;
  tiers: TierInput[] | null;
  basis: 'tax_included' | 'tax_excluded';
  minAmount: number | null;
  maxAmount: number | null;
  effectiveFrom: string;
}

export async function saveCommissionRule(input: CommissionRuleInput): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  if (!input.name.trim()) return { ok: false, message: 'ルール名を入力してください' };
  // 店舗目標達成ボーナス: 店舗売上が目標額(min_amount)以上の月に固定額(fixed_amount)を支給する仕様のため、
  // 目標額・支給額とも必須とする（createPayrollRun の store_target 処理と対応）。
  if (input.targetType === 'store_target') {
    if (input.minAmount == null || input.minAmount <= 0) return { ok: false, message: '目標額を入力してください' };
    if (input.fixedAmount == null || input.fixedAmount <= 0) return { ok: false, message: '支給額を入力してください' };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    name: input.name.trim(),
    target_type: input.targetType,
    profile_id: input.profileId,
    store_id: input.storeId,
    method: input.method,
    rate: input.method === 'rate' ? input.rate : null,
    fixed_amount: input.method === 'fixed' ? input.fixedAmount : null,
    tiers: input.method === 'tiered' ? input.tiers : null,
    basis: input.basis,
    min_amount: input.minAmount,
    max_amount: input.maxAmount,
    effective_from: input.effectiveFrom,
    updated_by: ctx.userId,
  };

  const { error } = input.id
    ? await supabase.from('commission_rules').update(payload).eq('id', input.id)
    : await supabase.from('commission_rules').insert({ ...payload, created_by: ctx.userId });

  if (error) return { ok: false, message: '歩合ルールの保存に失敗しました' };
  revalidatePath('/app/payroll');
  return { ok: true, message: '歩合ルールを保存しました' };
}

// ---------------------------------------------------------------
// 給与計算（期間集計）
// ---------------------------------------------------------------

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface RunRow {
  id: string;
  organization_id: string;
  store_id: string | null;
  period_start: string;
  period_end: string;
}

function pickRule<T extends { profile_id: string; store_id: string | null; effective_from: string }>(
  rules: T[],
  profileId: string,
  runStoreId: string | null
): T | null {
  const candidates = rules.filter((r) => r.profile_id === profileId);
  if (candidates.length === 0) return null;
  const scored = candidates.map((r) => ({
    rule: r,
    score: runStoreId && r.store_id === runStoreId ? 2 : r.store_id === null ? 1 : 0,
  }));
  scored.sort((a, b) => b.score - a.score || b.rule.effective_from.localeCompare(a.rule.effective_from));
  return scored[0].rule;
}

/**
 * calcCommission の段階料率(tiered)ロジックの内訳版。
 * lib/payroll.ts は変更禁止のため、明細表示用に帯域ごとの内訳（対象売上→適用率→金額）を
 * ここでのみ複製して算出する（合計額は calcCommission の結果と一致する）。
 */
function tierBreakdownOf(
  tiers: { from: number; to: number | null; rate: number }[],
  salesAmount: number
): { from: number; to: number | null; rate: number; bandAmount: number; amount: number }[] {
  const rows: { from: number; to: number | null; rate: number; bandAmount: number; amount: number }[] = [];
  for (const tier of tiers) {
    const upper = tier.to ?? Infinity;
    if (salesAmount <= tier.from) continue;
    const bandAmount = Math.min(salesAmount, upper) - tier.from;
    if (bandAmount <= 0) continue;
    rows.push({ from: tier.from, to: tier.to, rate: tier.rate, bandAmount, amount: Math.floor((bandAmount * tier.rate) / 100) });
  }
  return rows;
}

export interface CommissionBreakdownItem {
  name: string;
  basis: 'tax_excluded' | 'tax_included' | 'store_target';
  method: 'fixed' | 'rate' | 'tiered';
  salesAmount: number;
  rate?: number | null;
  tiers?: { from: number; to: number | null; rate: number; bandAmount: number; amount: number }[];
  achieved?: boolean;
  amount: number;
}

/** 期間内の勤怠・売上・ルールから payroll_items を生成する（作成／再計算で共用） */
async function generatePayrollItems(supabase: SupabaseClient, ctx: { organizationId: string; userId: string }, run: RunRow) {
  await supabase.from('payroll_items').delete().eq('payroll_run_id', run.id);

  let entriesQuery = supabase
    .from('time_entries')
    .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
    .eq('organization_id', ctx.organizationId)
    .in('status', ['closed', 'approved'])
    .gte('work_date', run.period_start)
    .lte('work_date', run.period_end);
  if (run.store_id) entriesQuery = entriesQuery.eq('store_id', run.store_id);
  const { data: entries } = await entriesQuery;

  const candidateIds = [...new Set((entries ?? []).map((e) => e.profile_id))];
  if (candidateIds.length === 0) {
    await supabase.from('payroll_runs').update({ note: '対象期間に勤怠記録がありませんでした' }).eq('id', run.id);
    return;
  }

  const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', candidateIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: rules } = await supabase
    .from('payroll_rules')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .in('profile_id', candidateIds)
    .eq('status', 'active')
    .lte('effective_from', run.period_end)
    .or(`effective_to.is.null,effective_to.gte.${run.period_start}`);

  let ordersQuery = supabase
    .from('orders')
    .select('staff_id, subtotal, total')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'paid')
    .in('staff_id', candidateIds)
    .gte('business_date', run.period_start)
    .lte('business_date', run.period_end);
  if (run.store_id) ordersQuery = ordersQuery.eq('store_id', run.store_id);
  const { data: orders } = await ordersQuery;

  const salesByProfile = new Map<string, { taxExcluded: number; taxIncluded: number }>();
  for (const o of orders ?? []) {
    if (!o.staff_id) continue;
    const current = salesByProfile.get(o.staff_id) ?? { taxExcluded: 0, taxIncluded: 0 };
    current.taxExcluded += o.subtotal;
    current.taxIncluded += o.total;
    salesByProfile.set(o.staff_id, current);
  }

  const { data: commissionRules } = await supabase
    .from('commission_rules')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .eq('target_type', 'personal_sales')
    .eq('status', 'active')
    .lte('effective_from', run.period_end)
    .or(`effective_to.is.null,effective_to.gte.${run.period_start}`);

  // 店舗目標ボーナス（target_type='store_target'）:
  // 「店舗売上が目標額(min_amount)以上の月に固定額(fixed_amount)を支給」という仕様。
  // calcCommission の fixed/min_amount はクランプ（下限保証）用のため、この閾値判定は
  // ここで専用に実装する（店舗売上 >= 目標額 なら fixed_amount、未満なら0円）。
  const { data: storeTargetRules } = await supabase
    .from('commission_rules')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .eq('target_type', 'store_target')
    .eq('status', 'active')
    .lte('effective_from', run.period_end)
    .or(`effective_to.is.null,effective_to.gte.${run.period_start}`);

  // 主な勤務店舗（最頻値）を先に確定する（店舗目標ボーナスの判定に使うため）
  const primaryStoreByProfile = new Map<string, string | null>();
  for (const profileId of candidateIds) {
    const myEntries = (entries ?? []).filter((e) => e.profile_id === profileId);
    const storeCounts = new Map<string, number>();
    for (const e of myEntries) storeCounts.set(e.store_id, (storeCounts.get(e.store_id) ?? 0) + 1);
    primaryStoreByProfile.set(profileId, run.store_id ?? [...storeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  }
  const relevantStoreIds = [...new Set([...primaryStoreByProfile.values()].filter((s): s is string => !!s))];
  const storeSalesTotal = new Map<string, number>();
  if (relevantStoreIds.length > 0 && (storeTargetRules ?? []).length > 0) {
    const { data: closings } = await supabase
      .from('daily_closings')
      .select('store_id, sales_total')
      .eq('organization_id', ctx.organizationId)
      .in('store_id', relevantStoreIds)
      .in('status', ['closed', 'approved'])
      .gte('business_date', run.period_start)
      .lte('business_date', run.period_end);
    for (const c of closings ?? []) {
      storeSalesTotal.set(c.store_id, (storeSalesTotal.get(c.store_id) ?? 0) + c.sales_total);
    }
  }

  const skipped: string[] = [];
  const items: Record<string, unknown>[] = [];

  for (const profileId of candidateIds) {
    const rule = pickRule(rules ?? [], profileId, run.store_id);
    if (!rule) {
      skipped.push(nameById.get(profileId) ?? profileId);
      continue;
    }

    const myEntries = (entries ?? []).filter((e) => e.profile_id === profileId && e.clock_in_at && e.clock_out_at);
    const days: DayAttendance[] = myEntries.map((e) =>
      summarizeEntry({
        clockInAt: new Date(e.clock_in_at as string),
        clockOutAt: new Date(e.clock_out_at as string),
        breakMinutes: e.break_minutes,
        isHolidayWork: e.entry_type === 'holiday_work',
      })
    );
    const dailyBreakdown = myEntries.map((e, i) => ({
      date: e.work_date,
      clockIn: formatTime(e.clock_in_at),
      clockOut: formatTime(e.clock_out_at),
      breakMinutes: e.break_minutes,
      entryType: e.entry_type,
      workMinutes: formatMinutes(days[i].workMinutes),
      overtimeMinutes: formatMinutes(days[i].overtimeMinutes),
      nightMinutes: formatMinutes(days[i].nightMinutes),
      holidayMinutes: formatMinutes(days[i].holidayMinutes ?? 0),
    }));

    const sales = salesByProfile.get(profileId) ?? { taxExcluded: 0, taxIncluded: 0 };
    const applicableCommissions = (commissionRules ?? []).filter(
      (r) =>
        (r.profile_id === null || r.profile_id === profileId) &&
        (r.store_id === null || r.store_id === run.store_id)
    );
    const commissionBreakdown: CommissionBreakdownItem[] = [];
    let commissionTotal = 0;
    for (const cr of applicableCommissions) {
      const salesAmount = cr.basis === 'tax_excluded' ? sales.taxExcluded : sales.taxIncluded;
      const amount = calcCommission(
        {
          targetType: cr.target_type,
          method: cr.method,
          rate: cr.rate,
          fixedAmount: cr.fixed_amount,
          tiers: cr.tiers,
          minAmount: cr.min_amount,
          maxAmount: cr.max_amount,
        },
        salesAmount
      );
      if (amount !== 0) {
        commissionBreakdown.push({
          name: cr.name,
          basis: cr.basis,
          method: cr.method,
          salesAmount,
          rate: cr.method === 'rate' ? cr.rate : undefined,
          tiers: cr.method === 'tiered' && cr.tiers ? tierBreakdownOf(cr.tiers, salesAmount) : undefined,
          amount,
        });
        commissionTotal += amount;
      }
    }

    // 店舗目標ボーナス: 対象スタッフ（profile_id null=全員 or 一致）かつ店舗（store_id null=主勤務店舗 or 一致）
    const effectiveStoreId = primaryStoreByProfile.get(profileId) ?? null;
    const applicableStoreTargets = (storeTargetRules ?? []).filter(
      (r) => (r.profile_id === null || r.profile_id === profileId) && (r.store_id === null || r.store_id === effectiveStoreId)
    );
    for (const cr of applicableStoreTargets) {
      const storeSales = effectiveStoreId ? storeSalesTotal.get(effectiveStoreId) ?? 0 : 0;
      const targetAmount = cr.min_amount ?? 0;
      const achieved = storeSales >= targetAmount;
      const amount = achieved ? cr.fixed_amount ?? 0 : 0;
      if (amount !== 0) {
        commissionBreakdown.push({
          name: cr.name,
          basis: 'store_target',
          method: 'fixed',
          salesAmount: storeSales,
          achieved,
          amount,
        });
        commissionTotal += amount;
      }
    }

    const preview = calcPayroll(
      {
        payType: rule.pay_type,
        baseAmount: rule.base_amount,
        overtimeRate: rule.overtime_rate,
        nightRate: rule.night_rate,
        holidayRate: rule.holiday_rate,
        commuteAllowance: rule.commute_allowance,
        allowances: rule.allowances ?? [],
      },
      days,
      commissionTotal
    );

    const primaryStore = primaryStoreByProfile.get(profileId) ?? null;

    items.push({
      organization_id: ctx.organizationId,
      payroll_run_id: run.id,
      profile_id: profileId,
      store_id: primaryStore,
      work_days: preview.workDays,
      work_minutes: preview.workMinutes,
      overtime_minutes: preview.overtimeMinutes,
      night_minutes: preview.nightMinutes,
      holiday_minutes: preview.holidayMinutes,
      base_pay: preview.basePay,
      overtime_pay: preview.overtimePay,
      night_pay: preview.nightPay,
      holiday_pay: preview.holidayPay,
      commute_pay: preview.commutePay,
      allowance_total: preview.allowanceTotal,
      commission_total: preview.commissionTotal,
      deduction_total: 0,
      gross_total: preview.grossTotal,
      breakdown: {
        days: dailyBreakdown,
        hourlyBase: preview.hourlyBase,
        payType: rule.pay_type,
        baseAmount: rule.base_amount,
        holidayRate: rule.holiday_rate,
        sales,
        commissions: commissionBreakdown,
      },
      created_by: ctx.userId,
    });
  }

  if (items.length > 0) {
    await supabase.from('payroll_items').insert(items);
  }

  await supabase
    .from('payroll_runs')
    .update({
      note: skipped.length > 0 ? `給与ルール未設定のため対象外: ${skipped.join('、')}` : null,
    })
    .eq('id', run.id);
}

export interface CreateRunInput {
  title: string;
  periodStart: string;
  periodEnd: string;
  storeId: string | null;
}

export async function createPayrollRun(input: CreateRunInput): Promise<ActionResult & { runId?: string }> {
  const ctx = await requirePermission('payroll.manage');
  if (!input.title.trim()) return { ok: false, message: 'タイトルを入力してください' };
  if (input.periodStart > input.periodEnd) return { ok: false, message: '期間の指定が正しくありません' };

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from('payroll_runs')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      title: input.title.trim(),
      period_start: input.periodStart,
      period_end: input.periodEnd,
      status: 'draft',
      created_by: ctx.userId,
    })
    .select('id, organization_id, store_id, period_start, period_end')
    .single();

  if (error || !run) return { ok: false, message: '給与計算の作成に失敗しました' };

  await generatePayrollItems(supabase, ctx, run);
  revalidatePath('/app/payroll');
  return { ok: true, message: '給与計算を作成しました', runId: run.id };
}

export async function recalcPayrollRun(runId: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('id, organization_id, store_id, period_start, period_end, status')
    .eq('id', runId)
    .single();
  if (!run) return { ok: false, message: '給与計算が見つかりません' };
  if (run.status !== 'draft') return { ok: false, message: '下書き状態のみ再計算できます' };

  await generatePayrollItems(supabase, ctx, run);
  revalidatePath(`/app/payroll/${runId}`);
  return { ok: true, message: '再計算しました' };
}

export async function confirmPayrollRun(runId: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();
  const { data: run } = await supabase.from('payroll_runs').select('status').eq('id', runId).single();
  if (!run) return { ok: false, message: '給与計算が見つかりません' };
  if (run.status !== 'draft') return { ok: false, message: '下書き状態のみ確定できます' };

  const { error } = await supabase
    .from('payroll_runs')
    .update({ status: 'confirmed', updated_by: ctx.userId })
    .eq('id', runId);
  if (error) return { ok: false, message: '確定に失敗しました' };
  revalidatePath(`/app/payroll/${runId}`);
  revalidatePath('/app/payroll');
  return { ok: true, message: '給与計算を確定しました' };
}

export async function approvePayrollRun(runId: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('status, organization_id, store_id, title')
    .eq('id', runId)
    .single();
  if (!run) return { ok: false, message: '給与計算が見つかりません' };
  if (run.status !== 'confirmed') return { ok: false, message: '確定済みの給与計算のみ承認できます' };

  const { error } = await supabase
    .from('payroll_runs')
    .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) return { ok: false, message: '承認に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: run.organization_id,
    p_store: run.store_id,
    p_action: 'payroll.approve',
    p_target_table: 'payroll_runs',
    p_target_id: runId,
    p_before: { status: 'confirmed' },
    p_after: { status: 'approved' },
    p_note: `給与計算「${run.title}」を承認`,
  });

  revalidatePath(`/app/payroll/${runId}`);
  revalidatePath('/app/payroll');
  return { ok: true, message: '給与計算を承認しました' };
}
