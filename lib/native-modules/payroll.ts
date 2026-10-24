import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import {
  currentJstYear,
  loadMyPayslips,
  loadNenchoPage,
  loadPayrollRuleLists,
  loadPayrollRunDetail,
  loadPayrollRuns,
  loadPayrollStaffOptions,
} from '@/lib/payroll-server';
import {
  isPayrollId,
  jstToday,
  lastMonthRange,
  nenchoAdminDetail,
  nenchoYearFrom,
  normalizeNenchoData,
  parseCommissionRuleInput,
  parseCreateBonusRunInput,
  parseCreateRunInput,
  parseNenchoSave,
  parsePayrollRuleInput,
  parsePayrollView,
  payrollBreakdownLines,
  payrollDayRows,
  payrollTotals,
  runPeriodLabel,
  snapshotView,
  METHOD_LABEL,
  PAY_TYPE_LABEL,
} from '@/lib/native-payroll';
import {
  approvePayrollRun,
  confirmPayrollRun,
  createBonusRun,
  createPayrollRun,
  recalcPayrollRun,
  revertPayrollRunToDraft,
  saveCommissionRule,
  savePayrollRule,
} from '@/app/app/payroll/actions';
import { confirmNencho, rejectNencho, saveNenchoDraft, setNenchoReviewing, submitNencho } from '@/app/app/payroll/nencho/actions';
import type { SessionContext } from '@/lib/auth';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 給与・歩合の iPad ネイティブ（GET part=payroll ／ POST payroll…・nencho…）。
 * 中身・操作は Web の /app/payroll・/app/payroll/[runId]・/app/payroll/nencho と同じ
 * （読み込み lib/payroll-server.ts、操作 app/app/payroll/actions.ts・nencho/actions.ts）。2026-10-24 Ronnie「全部ネイティブ」
 *   GET part=payroll              … 一覧（管理者：給与ルール・歩合ルール・給与計算／スタッフ：自分の給与明細）
 *   GET part=payroll&run=<id>     … 詳細（管理者：明細・確定・承認／スタッフ：自分の給与明細）
 *   GET part=payroll&view=nencho  … 年末調整（&year=2026&status=submitted）
 * 権限は Web と同じ（payroll.manage／payroll.view_all。Server Action の中でももう一度見る）
 */

const FEATURE_OFF: NativeModuleResult = { status: 403, body: { ok: false, error: '給与・歩合は使えません' } };
const NO_MANAGE: NativeModuleResult = { status: 403, body: { ok: false, error: '給与を管理する権限がありません' } };
const bad = (error: string): NativeModuleResult => ({ status: 400, body: { ok: false, error } });

/** Server Action の返事（{ ok, message }）を iPad の返事に */
const reply = (r: { ok: boolean; message: string; runId?: string }): NativeModuleResult => ({
  body: { ok: r.ok, message: r.message, ...(r.ok ? {} : { error: r.message }), ...(r.runId ? { id: r.runId } : {}) },
});

const featureOff = (ctx: SessionContext) => ctx.disabledFeatures?.has('payroll') === true;
/** 数（null・文字は 0。iPad が読めないと画面ごと出なくなるので） */
const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const options = (ctx: SessionContext) => ctx.stores.map((s) => ({ id: s.id, name: s.name }));

// ---------------------------------------------------------------
// GET
// ---------------------------------------------------------------

export const payrollGet: NativeModuleGet = async ({ ctx, url }) => {
  if (featureOff(ctx) || !ctx.organizationId) return FEATURE_OFF;
  const view = parsePayrollView(url.searchParams);
  if ('error' in view) return bad(view.error);
  const organizationId = ctx.organizationId;
  const canManage = can(ctx.role, 'payroll.manage');
  const canReview = can(ctx.role, 'payroll.view_all');
  const supabase = await createClient();
  const member = { ...ctx, organizationId };

  if (view.view === 'run') {
    const detail = await loadPayrollRunDetail(supabase, member, view.runId, canManage);
    switch (detail.kind) {
      case 'self-missing':
        return { body: { ok: true, view: 'run', mode: 'empty', title: 'この給与明細は表示できません', message: '対象期間に給与データがないか、確定前のため表示できません' } };
      case 'self-not-ready':
        return { body: { ok: true, view: 'run', mode: 'empty', title: 'この給与明細はまだ表示できません', message: '確定後に閲覧できるようになります' } };
      case 'self': {
        const p = detail.payslip;
        return {
          body: {
            ok: true,
            view: 'run',
            mode: 'self',
            payslip: {
              runTitle: p.runTitle,
              runType: p.runType,
              profileName: p.profileName,
              organizationName: p.organizationName,
              workDays: n(p.workDays),
              workMinutes: n(p.workMinutes),
              overtimeMinutes: n(p.overtimeMinutes),
              nightMinutes: n(p.nightMinutes),
              holidayMinutes: n(p.holidayMinutes),
              basePay: n(p.basePay),
              overtimePay: n(p.overtimePay),
              nightPay: n(p.nightPay),
              holidayPay: n(p.holidayPay),
              commutePay: n(p.commutePay),
              allowanceTotal: n(p.allowanceTotal),
              commissionTotal: n(p.commissionTotal),
              grossTotal: n(p.grossTotal),
              periodLabel:
                p.runType === 'bonus' ? `支給日: ${formatDate(p.paymentDate)}` : `対象期間: ${formatDate(p.periodStart)} 〜 ${formatDate(p.periodEnd)}`,
            },
          },
        };
      }
      case 'not-found':
        return { status: 404, body: { ok: false, error: '給与計算が見つかりません' } };
      case 'manage': {
        const { run, runType, storeName, views, bonusViews, nameByProfile } = detail;
        const target = storeName ?? '全社';
        const items = views.map((v) => ({
          id: v.id,
          profileName: v.profileName,
          workDays: n(v.workDays),
          workMinutes: n(v.workMinutes),
          overtimeMinutes: n(v.overtimeMinutes),
          nightMinutes: n(v.nightMinutes),
          holidayMinutes: n(v.holidayMinutes),
          basePay: n(v.basePay),
          overtimePay: n(v.overtimePay),
          nightPay: n(v.nightPay),
          holidayPay: n(v.holidayPay),
          commutePay: n(v.commutePay),
          allowanceTotal: n(v.allowanceTotal),
          commissionTotal: n(v.commissionTotal),
          grossTotal: n(v.grossTotal),
          lines: payrollBreakdownLines(v),
          days: payrollDayRows(v),
        }));
        return {
          body: {
            ok: true,
            view: 'run',
            mode: 'manage',
            run: {
              id: run.id,
              title: run.title,
              runType,
              status: run.status,
              description:
                runType === 'bonus'
                  ? `賞与｜支給日: ${formatDate(run.payment_date)}｜対象: ${target}`
                  : `${formatDate(run.period_start)} 〜 ${formatDate(run.period_end)}｜対象: ${target}`,
              note: run.note ?? null,
              // CSV の名前（Web の /app/payroll/<id>/export と同じ）
              csvName: `payroll_${run.period_start}_${run.title}.csv`,
            },
            snapshot: run.status === 'approved' && run.rules_snapshot ? snapshotView(run.rules_snapshot, nameByProfile) : null,
            items: runType === 'bonus' ? [] : items,
            totals: runType === 'bonus' ? null : payrollTotals(items),
            bonusItems: runType === 'bonus' ? bonusViews.map((b) => ({ id: b.id, profileName: b.profileName, amount: n(b.amount) })) : [],
            bonusTotal: bonusViews.reduce((a, i) => a + n(i.amount), 0),
          },
        };
      }
    }
  }

  if (view.view === 'nencho') {
    const year = nenchoYearFrom(view.year, currentJstYear());
    const page = await loadNenchoPage(supabase, member, { year, status: view.status ?? undefined }, canReview);
    return {
      body: {
        ok: true,
        view: 'nencho',
        year,
        yearOptions: page.yearOptions,
        status: view.status ?? '',
        canReview,
        canManage,
        own: { status: page.ownStatus, data: normalizeNenchoData(page.ownData), reviewNote: page.ownReviewNote },
        adminRows: page.adminRows.map((r) => ({
          id: r.id,
          profileName: r.profileName,
          year: r.year,
          status: r.status,
          submittedLabel: formatDate(r.submittedAt),
          ...nenchoAdminDetail(r),
        })),
      },
    };
  }

  // 一覧
  if (!canManage) {
    const { runs, itemByRunId } = await loadMyPayslips(supabase, member);
    return {
      body: {
        ok: true,
        view: 'list',
        canManage: false,
        payslips: runs.map((run) => {
          const runType = run.run_type ?? 'salary';
          return {
            id: run.id,
            title: run.title,
            runType,
            periodLabel: runPeriodLabel(runType, run.period_start, run.period_end, run.payment_date),
            grossTotal: itemByRunId.get(run.id)?.gross_total == null ? null : n(itemByRunId.get(run.id)?.gross_total),
          };
        }),
      },
    };
  }

  const [staff, { rules, commissionRules }, runs] = await Promise.all([
    loadPayrollStaffOptions(supabase, organizationId),
    loadPayrollRuleLists(supabase, organizationId),
    loadPayrollRuns(supabase, organizationId),
  ]);
  const nameByProfile = new Map(staff.map((s) => [s.id, s.name]));
  const stores = options(ctx);
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
  const toNum = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const now = new Date();
  const lastMonth = lastMonthRange(now);
  const today = jstToday(now);

  return {
    body: {
      ok: true,
      view: 'list',
      canManage: true,
      staff,
      stores,
      defaults: {
        periodStart: lastMonth.start,
        periodEnd: lastMonth.end,
        salaryTitle: lastMonth.label,
        bonusTitle: `${today.slice(0, 4)}年 賞与`,
        today,
      },
      rules: rules.map((r) => ({
        id: r.id as string,
        profileId: r.profile_id as string,
        profileName: nameByProfile.get(r.profile_id) ?? '—',
        storeId: (r.store_id as string | null) ?? null,
        storeName: r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全店舗共通',
        payType: r.pay_type as string,
        payTypeLabel: PAY_TYPE_LABEL[r.pay_type] ?? '',
        baseAmount: toNum(r.base_amount) ?? 0,
        overtimeRate: toNum(r.overtime_rate) ?? 0,
        nightRate: toNum(r.night_rate) ?? 0,
        holidayRate: toNum(r.holiday_rate) ?? 0,
        commuteAllowance: toNum(r.commute_allowance) ?? 0,
        allowances: (Array.isArray(r.allowances) ? r.allowances : []).map((a: { name?: unknown; amount?: unknown; per?: unknown }) => ({
          name: typeof a?.name === 'string' ? a.name : '',
          amount: toNum(a?.amount) ?? 0,
          per: a?.per === 'day' ? 'day' : 'month',
        })),
        closingDay: toNum(r.closing_day) ?? 31,
        paymentDay: toNum(r.payment_day) ?? 25,
        effectiveFrom: r.effective_from as string,
        effectiveFromLabel: formatDate(r.effective_from),
      })),
      commissionRules: commissionRules.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        targetType: r.target_type as string,
        profileId: (r.profile_id as string | null) ?? null,
        profileName: r.profile_id ? nameByProfile.get(r.profile_id) ?? '—' : '全スタッフ',
        storeId: (r.store_id as string | null) ?? null,
        storeName: r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全店舗',
        method: r.method as string,
        methodLabel: METHOD_LABEL[r.method] ?? '',
        rate: toNum(r.rate),
        fixedAmount: toNum(r.fixed_amount),
        tiers: Array.isArray(r.tiers)
          ? r.tiers.map((t: { from?: unknown; to?: unknown; rate?: unknown }) => ({ from: toNum(t?.from) ?? 0, to: toNum(t?.to), rate: toNum(t?.rate) ?? 0 }))
          : null,
        basis: r.basis as string,
        basisLabel: r.basis === 'tax_excluded' ? '税抜' : '税込',
        minAmount: toNum(r.min_amount),
        maxAmount: toNum(r.max_amount),
        effectiveFrom: r.effective_from as string,
        effectiveFromLabel: formatDate(r.effective_from),
      })),
      runs: runs.map((r) => {
        const runType = (r.run_type ?? 'salary') as string;
        return {
          id: r.id as string,
          runType,
          title: r.title as string,
          periodLabel: runPeriodLabel(runType, r.period_start, r.period_end, r.payment_date),
          storeName: r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全社',
          status: r.status as string,
          createdLabel: formatDate(r.created_at),
        };
      }),
    },
  };
};

// ---------------------------------------------------------------
// POST（給与ルール・歩合ルール・給与計算は payroll.manage）
// ---------------------------------------------------------------

const managed =
  (run: (raw: Record<string, unknown>) => Promise<NativeModuleResult>): NativeModulePost =>
  async ({ ctx, raw }) => {
    if (featureOff(ctx)) return FEATURE_OFF;
    if (!can(ctx.role, 'payroll.manage')) return NO_MANAGE;
    return run(raw);
  };

const runIdOf = (raw: Record<string, unknown>) => (isPayrollId(raw.runId) ? raw.runId : null);

/** 給与ルールの追加・編集 */
export const payrollRuleSavePost = managed(async (raw) => {
  const p = parsePayrollRuleInput(raw);
  return p.ok ? reply(await savePayrollRule(p.value)) : bad(p.error);
});

/** 歩合ルールの追加・編集 */
export const payrollCommissionSavePost = managed(async (raw) => {
  const p = parseCommissionRuleInput(raw);
  return p.ok ? reply(await saveCommissionRule(p.value)) : bad(p.error);
});

/** 給与計算の新規作成（期間集計）。返事の id で詳細を開く */
export const payrollRunCreatePost = managed(async (raw) => {
  const p = parseCreateRunInput(raw);
  return p.ok ? reply(await createPayrollRun(p.value)) : bad(p.error);
});

/** 賞与計算の新規作成（スタッフ別の金額を手入力） */
export const payrollBonusCreatePost = managed(async (raw) => {
  const p = parseCreateBonusRunInput(raw);
  return p.ok ? reply(await createBonusRun(p.value)) : bad(p.error);
});

export const payrollRunRecalcPost = managed(async (raw) => {
  const id = runIdOf(raw);
  return id ? reply(await recalcPayrollRun(id)) : bad('内容が正しくありません');
});

export const payrollRunConfirmPost = managed(async (raw) => {
  const id = runIdOf(raw);
  return id ? reply(await confirmPayrollRun(id)) : bad('内容が正しくありません');
});

export const payrollRunApprovePost = managed(async (raw) => {
  const id = runIdOf(raw);
  return id ? reply(await approvePayrollRun(id)) : bad('内容が正しくありません');
});

export const payrollRunRevertPost = managed(async (raw) => {
  const id = runIdOf(raw);
  return id ? reply(await revertPayrollRunToDraft(id)) : bad('内容が正しくありません');
});

// ---------------------------------------------------------------
// POST 年末調整（本人の下書き・提出は誰でも。確認の流れは payroll.manage）
// ---------------------------------------------------------------

export const nenchoSavePost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  const p = parseNenchoSave(raw);
  return p.ok ? reply(await saveNenchoDraft(p.value)) : bad(p.error);
};

export const nenchoSubmitPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  const year = typeof raw.year === 'number' && Number.isInteger(raw.year) ? raw.year : null;
  return year != null ? reply(await submitNencho(year)) : bad('内容が正しくありません');
};

const nenchoIdOf = (raw: Record<string, unknown>) => (isPayrollId(raw.id) ? raw.id : null);

export const nenchoReviewingPost = managed(async (raw) => {
  const id = nenchoIdOf(raw);
  return id ? reply(await setNenchoReviewing(id)) : bad('内容が正しくありません');
});

export const nenchoConfirmPost = managed(async (raw) => {
  const id = nenchoIdOf(raw);
  return id ? reply(await confirmNencho(id)) : bad('内容が正しくありません');
});

export const nenchoRejectPost = managed(async (raw) => {
  const id = nenchoIdOf(raw);
  const note = typeof raw.note === 'string' ? raw.note : '';
  return id ? reply(await rejectNencho(id, note)) : bad('内容が正しくありません');
});
