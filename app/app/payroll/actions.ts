'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { calcPayroll, calcCommission, summarizeEntry, type DayAttendance, type PayrollPreview } from '@/lib/payroll';
import { formatTime, formatMinutes } from '@/lib/format';
import { groupDaysByRule, type PayrollRuleCandidate } from './rule-periods';

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
  if (input.storeId !== null && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '対象店舗にアクセス権がありません' };
  }
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
  if (input.storeId !== null && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '対象店舗にアクセス権がありません' };
  }
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
    const myEntries = (entries ?? []).filter((e) => e.profile_id === profileId && e.clock_in_at && e.clock_out_at);

    // 給与ルールの適用期間（effective_from/effective_to）を日単位で解決し、
    // 期間中に時給が変わる場合はルールごとにグループ化して計算する（app/app/payroll/rule-periods.ts）。
    const ruleCandidates: PayrollRuleCandidate[] = (rules ?? [])
      .filter((r) => r.profile_id === profileId)
      .map((r) => ({
        id: r.id,
        profileId: r.profile_id,
        storeId: r.store_id,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        payType: r.pay_type as PayrollRuleCandidate['payType'],
        baseAmount: r.base_amount,
        overtimeRate: r.overtime_rate,
        nightRate: r.night_rate,
        holidayRate: r.holiday_rate,
        commuteAllowance: r.commute_allowance,
        allowances: (r.allowances ?? []) as PayrollRuleCandidate['allowances'],
      }));

    const entryDays = myEntries.map((e) => ({ workDate: e.work_date as string, entry: e }));
    const { groups } = groupDaysByRule(entryDays, ruleCandidates, profileId, run.store_id);

    if (groups.length === 0) {
      skipped.push(nameById.get(profileId) ?? profileId);
      continue;
    }

    // 区間（ルール）ごとに勤怠集計・給与試算を行い、歩合を含まない金額を合算する
    // （歩合は集計対象期間全体で1回だけ計算し、最後に加算する）。
    type DailyBreakdownRow = {
      date: string;
      clockIn: string;
      clockOut: string;
      breakMinutes: number;
      entryType: string;
      workMinutes: string;
      overtimeMinutes: string;
      nightMinutes: string;
      holidayMinutes: string;
    };
    const dailyBreakdown: DailyBreakdownRow[] = [];
    const periodBreakdown: {
      effectiveFrom: string;
      effectiveTo: string | null;
      rangeStart: string;
      rangeEnd: string;
      payType: PayrollRuleCandidate['payType'];
      baseAmount: number;
      hourlyBase: number;
      workDays: number;
      basePay: number;
      overtimePay: number;
      nightPay: number;
      holidayPay: number;
    }[] = [];

    let combined: Omit<PayrollPreview, 'commissionTotal' | 'grossTotal'> = {
      workDays: 0, workMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, holidayMinutes: 0,
      basePay: 0, overtimePay: 0, nightPay: 0, holidayPay: 0, commutePay: 0, allowanceTotal: 0,
      hourlyBase: 0,
    };

    for (const group of groups) {
      const groupDayAttendance: DayAttendance[] = group.days.map((d) =>
        summarizeEntry({
          clockInAt: new Date(d.entry.clock_in_at as string),
          clockOutAt: new Date(d.entry.clock_out_at as string),
          breakMinutes: d.entry.break_minutes,
          isHolidayWork: d.entry.entry_type === 'holiday_work',
        })
      );
      // 歩合(commissionTotal)は区間ごとではなく合算後に一度だけ加算するため 0 を渡す
      const groupPreview = calcPayroll(
        {
          payType: group.rule.payType,
          baseAmount: group.rule.baseAmount,
          overtimeRate: group.rule.overtimeRate,
          nightRate: group.rule.nightRate,
          holidayRate: group.rule.holidayRate,
          commuteAllowance: group.rule.commuteAllowance,
          allowances: group.rule.allowances,
        },
        groupDayAttendance,
        0
      );

      combined = {
        workDays: combined.workDays + groupPreview.workDays,
        workMinutes: combined.workMinutes + groupPreview.workMinutes,
        overtimeMinutes: combined.overtimeMinutes + groupPreview.overtimeMinutes,
        nightMinutes: combined.nightMinutes + groupPreview.nightMinutes,
        holidayMinutes: combined.holidayMinutes + groupPreview.holidayMinutes,
        basePay: combined.basePay + groupPreview.basePay,
        overtimePay: combined.overtimePay + groupPreview.overtimePay,
        nightPay: combined.nightPay + groupPreview.nightPay,
        holidayPay: combined.holidayPay + groupPreview.holidayPay,
        commutePay: combined.commutePay + groupPreview.commutePay,
        allowanceTotal: combined.allowanceTotal + groupPreview.allowanceTotal,
        // 直近の適用ルールの割増基礎時給を代表値として保持する（内訳は periodBreakdown を参照）
        hourlyBase: groupPreview.hourlyBase,
      };

      periodBreakdown.push({
        effectiveFrom: group.rule.effectiveFrom,
        effectiveTo: group.rule.effectiveTo,
        rangeStart: group.rangeStart,
        rangeEnd: group.rangeEnd,
        payType: group.rule.payType,
        baseAmount: group.rule.baseAmount,
        hourlyBase: groupPreview.hourlyBase,
        workDays: groupPreview.workDays,
        basePay: groupPreview.basePay,
        overtimePay: groupPreview.overtimePay,
        nightPay: groupPreview.nightPay,
        holidayPay: groupPreview.holidayPay,
      });

      dailyBreakdown.push(
        ...group.days.map((d, i) => ({
          date: d.entry.work_date as string,
          clockIn: formatTime(d.entry.clock_in_at),
          clockOut: formatTime(d.entry.clock_out_at),
          breakMinutes: d.entry.break_minutes as number,
          entryType: d.entry.entry_type as string,
          workMinutes: formatMinutes(groupDayAttendance[i].workMinutes),
          overtimeMinutes: formatMinutes(groupDayAttendance[i].overtimeMinutes),
          nightMinutes: formatMinutes(groupDayAttendance[i].nightMinutes),
          holidayMinutes: formatMinutes(groupDayAttendance[i].holidayMinutes ?? 0),
        }))
      );
    }
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));
    const lastRule = groups[groups.length - 1].rule;

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

    // 歩合を合算した最終値（区間ごとの計算では歩合を含めていないため、ここで一度だけ加算する）
    const grossTotal =
      combined.basePay +
      combined.overtimePay +
      combined.nightPay +
      combined.holidayPay +
      combined.commutePay +
      combined.allowanceTotal +
      commissionTotal;

    const primaryStore = primaryStoreByProfile.get(profileId) ?? null;

    items.push({
      organization_id: ctx.organizationId,
      payroll_run_id: run.id,
      profile_id: profileId,
      store_id: primaryStore,
      work_days: combined.workDays,
      work_minutes: combined.workMinutes,
      overtime_minutes: combined.overtimeMinutes,
      night_minutes: combined.nightMinutes,
      holiday_minutes: combined.holidayMinutes,
      base_pay: combined.basePay,
      overtime_pay: combined.overtimePay,
      night_pay: combined.nightPay,
      holiday_pay: combined.holidayPay,
      commute_pay: combined.commutePay,
      allowance_total: combined.allowanceTotal,
      commission_total: commissionTotal,
      deduction_total: 0,
      gross_total: grossTotal,
      breakdown: {
        days: dailyBreakdown,
        // 単一区間だった時代の互換用に、最新（直近）の適用ルールの値を代表値として残す。
        // 期間中に時給等が変わった場合の内訳は periods を参照する。
        hourlyBase: combined.hourlyBase,
        payType: lastRule.payType,
        baseAmount: lastRule.baseAmount,
        holidayRate: lastRule.holidayRate,
        sales,
        commissions: commissionBreakdown,
        periods: periodBreakdown,
        // payroll_runs 自体には内訳カラムが無いため、算出方式のバージョンは各 payroll_items.breakdown 内に記録する
        calcVersion: 'v2',
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
  if (input.storeId !== null && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '対象店舗にアクセス権がありません' };
  }
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
    .select('id, organization_id, store_id, period_start, period_end, status, run_type')
    .eq('id', runId)
    .single();
  if (!run) return { ok: false, message: '給与計算が見つかりません' };
  if (run.status !== 'draft') return { ok: false, message: '下書き状態のみ再計算できます' };
  if (run.run_type === 'bonus') {
    return { ok: false, message: '賞与は勤怠から自動計算されないため再計算できません。金額を確認のうえ確定してください' };
  }

  await generatePayrollItems(supabase, ctx, run);
  revalidatePath(`/app/payroll/${runId}`);
  return { ok: true, message: '再計算しました' };
}

// ---------------------------------------------------------------
// 賞与run（期間の勤怠集計は行わず、支給日＋スタッフ別金額の手入力で作成する）
// ---------------------------------------------------------------

export interface CreateBonusRunInput {
  title: string;
  paymentDate: string;
  storeId: string | null;
  items: { profileId: string; amount: number }[];
}

export async function createBonusRun(input: CreateBonusRunInput): Promise<ActionResult & { runId?: string }> {
  const ctx = await requirePermission('payroll.manage');
  if (input.storeId !== null && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '対象店舗にアクセス権がありません' };
  }
  if (!input.title.trim()) return { ok: false, message: 'タイトルを入力してください' };
  if (!input.paymentDate) return { ok: false, message: '支給日を入力してください' };
  const items = input.items.filter((i) => i.profileId && i.amount > 0);
  if (items.length === 0) return { ok: false, message: '対象スタッフと支給額を1件以上入力してください' };
  if (items.some((i) => !Number.isFinite(i.amount) || i.amount < 0)) {
    return { ok: false, message: '支給額は0以上の数値で入力してください' };
  }

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from('payroll_runs')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      title: input.title.trim(),
      run_type: 'bonus',
      payment_date: input.paymentDate,
      // period_start/period_end は NOT NULL のため支給日を設定する（賞与runは期間集計を行わない）
      period_start: input.paymentDate,
      period_end: input.paymentDate,
      status: 'draft',
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !run) return { ok: false, message: `賞与計算の作成に失敗しました: ${error?.message ?? '不明なエラー'}` };

  const rows = items.map((i) => ({
    organization_id: ctx.organizationId,
    payroll_run_id: run.id,
    profile_id: i.profileId,
    store_id: input.storeId,
    work_days: 0,
    work_minutes: 0,
    overtime_minutes: 0,
    night_minutes: 0,
    holiday_minutes: 0,
    base_pay: 0,
    overtime_pay: 0,
    night_pay: 0,
    holiday_pay: 0,
    commute_pay: 0,
    allowance_total: 0,
    commission_total: 0,
    deduction_total: 0,
    gross_total: Math.round(i.amount),
    breakdown: { type: 'bonus' },
    created_by: ctx.userId,
  }));
  const { error: itemsError } = await supabase.from('payroll_items').insert(rows);
  if (itemsError) {
    await supabase.from('payroll_runs').delete().eq('id', run.id);
    return { ok: false, message: `支給内訳の作成に失敗しました: ${itemsError.message}` };
  }

  revalidatePath('/app/payroll');
  return { ok: true, message: '賞与計算を作成しました', runId: run.id };
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
