import { yen, formatDate, formatDateTime, formatMinutes } from '@/lib/format';
import type { AllowanceInput, CommissionRuleInput, CreateBonusRunInput, CreateRunInput, PayrollRuleInput, TierInput } from '@/app/app/payroll/actions';
import type { PayrollItemView } from '@/components/payroll/breakdown-panel';
import type { RulesSnapshot } from '@/components/payroll/rules-snapshot-panel';
import type { NenchoAdminRow } from '@/components/payroll/nencho-admin-panel';
import type { NenchoData } from '@/app/app/payroll/nencho/schema';

/**
 * 給与・歩合の iPad ネイティブ（GET part=payroll ／ POST payroll…・nencho…）の決まりごと。
 * 読み込みは lib/payroll-server.ts（Web と同じ）、操作は Web と同じ Server Action（app/app/payroll/actions.ts・nencho/actions.ts）。
 * ここは純粋な検証と、Web の画面と同じ文言の組み立てだけ（tests/native-payroll.test.ts）。2026-10-24 Ronnie「全部ネイティブ」
 */

export const RUN_STATUS_LABEL: Record<string, string> = { draft: '下書き', confirmed: '確定済み', approved: '承認済み' };
export const RUN_TYPE_LABEL: Record<string, string> = { salary: '給与', bonus: '賞与' };
export const PAY_TYPE_LABEL: Record<string, string> = { monthly: '月給', hourly: '時給', daily: '日給' };
export const METHOD_LABEL: Record<string, string> = { fixed: '固定額', rate: '料率', tiered: '段階料率' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BAD = '内容が正しくありません';

export const isPayrollId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

// ---------------------------------------------------------------
// GET の道（?run=<id> ／ ?view=nencho&year=&status=）
// ---------------------------------------------------------------

export type NativePayrollView =
  | { view: 'list' }
  | { view: 'run'; runId: string }
  | { view: 'nencho'; year: string | null; status: string | null };

export function parsePayrollView(params: URLSearchParams): NativePayrollView | { error: string } {
  if (params.get('view') === 'nencho') return { view: 'nencho', year: params.get('year'), status: params.get('status') };
  const run = params.get('run');
  if (run != null) return isPayrollId(run) ? { view: 'run', runId: run } : { error: BAD };
  return { view: 'list' };
}

/** 年末調整の対象年（Web の nencho/page.tsx と同じ：数字なら使う、無ければ今年） */
export function nenchoYearFrom(raw: string | null | undefined, fallback: number): number {
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
}

// ---------------------------------------------------------------
// 新規作成の初期値（Web の components/payroll/run-dialog.tsx と同じ）
// ---------------------------------------------------------------

/** 先月 1 日〜末日（日本時間）と「2026年9月分」 */
export function lastMonthRange(now: Date): { start: string; end: string; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value); // 今月（1〜12）
  const ly = m === 1 ? y - 1 : y;
  const lm = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
  const mm = String(lm).padStart(2, '0');
  return { start: `${ly}-${mm}-01`, end: `${ly}-${mm}-${String(lastDay).padStart(2, '0')}`, label: `${ly}年${lm}月分` };
}

/** 今日（日本時間 YYYY-MM-DD） */
export function jstToday(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

// ---------------------------------------------------------------
// POST の中身の検証（中身の決まりは Server Action がそのまま見る）
// ---------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const optNum = (v: unknown): number | null | undefined => (v == null ? null : num(v) ?? undefined);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
/** null／'' は null、UUID はそのまま、それ以外は undefined（だめ） */
const optId = (v: unknown): string | null | undefined => (v == null || v === '' ? null : isPayrollId(v) ? v : undefined);
const date = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);

export function parsePayrollRuleInput(raw: Record<string, unknown>): Parsed<PayrollRuleInput> {
  const r = (raw.rule ?? {}) as Record<string, unknown>;
  const id = optId(r.id);
  const profileId = r.profileId === '' || r.profileId == null ? '' : isPayrollId(r.profileId) ? r.profileId : null;
  const storeId = optId(r.storeId);
  const payType = oneOf(r.payType, ['monthly', 'hourly', 'daily'] as const);
  const n = {
    baseAmount: num(r.baseAmount),
    overtimeRate: num(r.overtimeRate),
    nightRate: num(r.nightRate),
    holidayRate: num(r.holidayRate),
    commuteAllowance: num(r.commuteAllowance),
    closingDay: num(r.closingDay),
    paymentDay: num(r.paymentDay),
  };
  const effectiveFrom = date(r.effectiveFrom);
  const allowancesRaw = Array.isArray(r.allowances) ? r.allowances : null;
  if (id === undefined || profileId === null || storeId === undefined || !payType || !effectiveFrom || !allowancesRaw || allowancesRaw.length > 50) {
    return { ok: false, error: BAD };
  }
  if (Object.values(n).some((v) => v === null)) return { ok: false, error: BAD };
  const allowances: AllowanceInput[] = [];
  for (const a of allowancesRaw as Record<string, unknown>[]) {
    const name = str(a?.name, 100);
    const amount = num(a?.amount);
    const per = oneOf(a?.per, ['month', 'day'] as const);
    if (name === null || amount === null || !per) return { ok: false, error: BAD };
    allowances.push({ name, amount, per });
  }
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      profileId,
      storeId,
      payType,
      baseAmount: n.baseAmount!,
      overtimeRate: n.overtimeRate!,
      nightRate: n.nightRate!,
      holidayRate: n.holidayRate!,
      commuteAllowance: n.commuteAllowance!,
      allowances,
      closingDay: n.closingDay!,
      paymentDay: n.paymentDay!,
      effectiveFrom,
    },
  };
}

export function parseCommissionRuleInput(raw: Record<string, unknown>): Parsed<CommissionRuleInput> {
  const r = (raw.rule ?? {}) as Record<string, unknown>;
  const id = optId(r.id);
  const name = str(r.name, 200);
  const targetType = oneOf(r.targetType, ['personal_sales', 'store_target'] as const);
  const profileId = optId(r.profileId);
  const storeId = optId(r.storeId);
  const method = oneOf(r.method, ['fixed', 'rate', 'tiered'] as const);
  const basis = oneOf(r.basis, ['tax_included', 'tax_excluded'] as const);
  const rate = optNum(r.rate);
  const fixedAmount = optNum(r.fixedAmount);
  const minAmount = optNum(r.minAmount);
  const maxAmount = optNum(r.maxAmount);
  const effectiveFrom = date(r.effectiveFrom);
  if (
    id === undefined || name === null || !targetType || profileId === undefined || storeId === undefined || !method || !basis ||
    rate === undefined || fixedAmount === undefined || minAmount === undefined || maxAmount === undefined || !effectiveFrom
  ) {
    return { ok: false, error: BAD };
  }
  let tiers: TierInput[] | null = null;
  if (r.tiers != null) {
    if (!Array.isArray(r.tiers) || r.tiers.length > 30) return { ok: false, error: BAD };
    tiers = [];
    for (const t of r.tiers as Record<string, unknown>[]) {
      const from = num(t?.from);
      const to = optNum(t?.to);
      const tierRate = num(t?.rate);
      if (from === null || to === undefined || tierRate === null) return { ok: false, error: BAD };
      tiers.push({ from, to, rate: tierRate });
    }
  }
  return {
    ok: true,
    value: { ...(id ? { id } : {}), name, targetType, profileId, storeId, method, rate, fixedAmount, tiers, basis, minAmount, maxAmount, effectiveFrom },
  };
}

export function parseCreateRunInput(raw: Record<string, unknown>): Parsed<CreateRunInput> {
  const title = str(raw.title, 200);
  const periodStart = date(raw.periodStart);
  const periodEnd = date(raw.periodEnd);
  const storeId = optId(raw.storeId);
  if (title === null || !periodStart || !periodEnd || storeId === undefined) return { ok: false, error: BAD };
  return { ok: true, value: { title, periodStart, periodEnd, storeId } };
}

export function parseCreateBonusRunInput(raw: Record<string, unknown>): Parsed<CreateBonusRunInput> {
  const title = str(raw.title, 200);
  const paymentDate = date(raw.paymentDate);
  const storeId = optId(raw.storeId);
  const itemsRaw = Array.isArray(raw.items) ? raw.items : null;
  if (title === null || !paymentDate || storeId === undefined || !itemsRaw || itemsRaw.length > 500) return { ok: false, error: BAD };
  const items: { profileId: string; amount: number }[] = [];
  for (const i of itemsRaw as Record<string, unknown>[]) {
    const amount = num(i?.amount);
    if (!isPayrollId(i?.profileId) || amount === null) return { ok: false, error: BAD };
    items.push({ profileId: i.profileId, amount });
  }
  return { ok: true, value: { title, paymentDate, storeId, items } };
}

/** 年末調整の下書き（中身＝data は Server Action が zod で見る） */
export function parseNenchoSave(raw: Record<string, unknown>): Parsed<{ year: number; data: NenchoData }> {
  const year = num(raw.year);
  if (year === null || !raw.data || typeof raw.data !== 'object') return { ok: false, error: BAD };
  return { ok: true, value: { year, data: raw.data as NenchoData } };
}

// ---------------------------------------------------------------
// 表示（Web の画面と同じ文言）
// ---------------------------------------------------------------

/** 一覧・明細の期間（賞与は支給日） */
export function runPeriodLabel(runType: string, periodStart: string | null, periodEnd: string | null, paymentDate: string | null): string {
  return runType === 'bonus' ? `支給日: ${formatDate(paymentDate)}` : `${formatDate(periodStart)} 〜 ${formatDate(periodEnd)}`;
}

export interface NativeBreakdownLine {
  text: string;
  /** 下にうすく並べる行（適用期間・段階料率の帯） */
  sub?: string[];
  /** 下の行のあとに太字で（段階料率の合計） */
  tail?: string;
  strong?: boolean;
}

/** 計算根拠（Web の components/payroll/breakdown-panel.tsx の「計算根拠」と同じ文言） */
export function payrollBreakdownLines(item: PayrollItemView): NativeBreakdownLine[] {
  const b = item.breakdown;
  const lines: NativeBreakdownLine[] = [];
  if (!b) return [{ text: `総支給 = ${yen(item.grossTotal)}`, strong: true }];
  if (b.periods && b.periods.length > 1) {
    lines.push({
      text: '適用期間の内訳（期間中に給与ルールが変更されています）',
      sub: b.periods.map(
        (p) =>
          `適用期間: ${p.rangeStart}〜${p.rangeEnd}（ルール適用開始${p.effectiveFrom}${p.effectiveTo ? `〜${p.effectiveTo}` : ''}） ` +
          `${PAY_TYPE_LABEL[p.payType] ?? ''}¥${(p.baseAmount ?? 0).toLocaleString('ja-JP')} → 基本給${yen(p.basePay)}` +
          `${p.overtimePay > 0 ? `／残業代${yen(p.overtimePay)}` : ''}` +
          `${p.nightPay > 0 ? `／深夜手当${yen(p.nightPay)}` : ''}` +
          `${p.holidayPay > 0 ? `／休日手当${yen(p.holidayPay)}` : ''}`
      ),
    });
  }
  const base = (b.baseAmount ?? 0).toLocaleString('ja-JP');
  const hourlyBase = (b.hourlyBase ?? 0).toLocaleString('ja-JP');
  lines.push({
    text:
      `基本給 = ${PAY_TYPE_LABEL[b.payType] ?? ''}` +
      (b.payType === 'hourly' ? `¥${base} × 実働${formatMinutes(item.workMinutes)}` : `¥${base}`) +
      ` = ${yen(item.basePay)}`,
  });
  if (item.overtimePay > 0) {
    lines.push({ text: `残業代 = 割増基礎時給¥${hourlyBase} × 残業${formatMinutes(item.overtimeMinutes)} = ${yen(item.overtimePay)}` });
  }
  if (item.nightPay > 0) {
    lines.push({ text: `深夜手当 = 割増基礎時給¥${hourlyBase} × 深夜${formatMinutes(item.nightMinutes)} = ${yen(item.nightPay)}` });
  }
  if (item.holidayPay > 0) {
    const rate = b.payType === 'hourly' ? (b.holidayRate ?? 1.35) - 1 : b.holidayRate ?? 1.35;
    lines.push({
      text: `休日手当 = 割増基礎時給¥${hourlyBase} × ${rate.toFixed(2)} × 休日${formatMinutes(item.holidayMinutes)} = ${yen(item.holidayPay)}`,
    });
  }
  if (item.commutePay > 0) lines.push({ text: `交通費 = ${item.workDays}日分 = ${yen(item.commutePay)}` });
  for (const c of b.commissions ?? []) {
    const basis = c.basis === 'tax_excluded' ? '税抜' : '税込';
    if (c.basis === 'store_target') {
      lines.push({ text: `ボーナス（${c.name}） = 店舗売上${yen(c.salesAmount)}${c.achieved ? ' ≧ 目標達成' : ' ＜ 目標未達'} → ${yen(c.amount)}` });
    } else if (c.method === 'tiered' && c.tiers) {
      lines.push({
        text: `歩合（${c.name}・段階料率） = ${basis}売上${yen(c.salesAmount)}`,
        sub: c.tiers.map((t) => `${yen(t.from)}〜${t.to != null ? yen(t.to) : '上限なし'}：${yen(t.bandAmount)} × ${t.rate}% = ${yen(t.amount)}`),
        tail: `→ 合計 ${yen(c.amount)}`,
      });
    } else if (c.method === 'rate') {
      lines.push({ text: `歩合（${c.name}） = ${basis}売上${yen(c.salesAmount)} × ${c.rate ?? ''}% → ${yen(c.amount)}` });
    } else {
      lines.push({ text: `歩合（${c.name}） = ${basis}売上${yen(c.salesAmount)} → ${yen(c.amount)}` });
    }
  }
  lines.push({ text: `総支給 = ${yen(item.grossTotal)}`, strong: true });
  return lines;
}

/** 日別勤怠（Web と同じ。休日が無い古い明細は 0:00） */
export function payrollDayRows(item: PayrollItemView) {
  return (item.breakdown?.days ?? []).map((d) => ({
    date: d.date,
    inOut: `${d.clockIn}〜${d.clockOut}`,
    work: d.workMinutes,
    overtime: d.overtimeMinutes,
    night: d.nightMinutes,
    holiday: d.holidayMinutes ?? '0:00',
  }));
}

type TotalsInput = Pick<
  PayrollItemView,
  | 'workDays' | 'workMinutes' | 'overtimeMinutes' | 'nightMinutes' | 'holidayMinutes'
  | 'basePay' | 'overtimePay' | 'nightPay' | 'holidayPay' | 'commutePay'
  | 'allowanceTotal' | 'commissionTotal' | 'grossTotal'
>;

/** 合計の行（Web の PayrollItemsTable の tfoot と同じ） */
export function payrollTotals(items: TotalsInput[]) {
  return items.reduce(
    (a, i) => ({
      workDays: a.workDays + i.workDays,
      workMinutes: a.workMinutes + i.workMinutes,
      overtimeMinutes: a.overtimeMinutes + i.overtimeMinutes,
      nightMinutes: a.nightMinutes + i.nightMinutes,
      holidayMinutes: a.holidayMinutes + i.holidayMinutes,
      basePay: a.basePay + i.basePay,
      overtimePay: a.overtimePay + i.overtimePay,
      nightPay: a.nightPay + i.nightPay,
      holidayPay: a.holidayPay + i.holidayPay,
      commutePay: a.commutePay + i.commutePay,
      allowanceTotal: a.allowanceTotal + i.allowanceTotal,
      commissionTotal: a.commissionTotal + i.commissionTotal,
      grossTotal: a.grossTotal + i.grossTotal,
    }),
    {
      workDays: 0, workMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, holidayMinutes: 0,
      basePay: 0, overtimePay: 0, nightPay: 0, holidayPay: 0, commutePay: 0,
      allowanceTotal: 0, commissionTotal: 0, grossTotal: 0,
    }
  );
}

/** 承認時に固定したルール（Web の components/payroll/rules-snapshot-panel.tsx と同じ文言） */
export function snapshotView(snapshot: RulesSnapshot, profileNameById: Map<string, string>) {
  const period = (from: string, to: string | null) => `${formatDate(from)} 〜 ${to ? formatDate(to) : '無期限'}`;
  return {
    generatedLabel: snapshot.generatedAt ? `記録日時: ${formatDateTime(snapshot.generatedAt)}` : null,
    note: snapshot.note ?? null,
    payrollRules: (snapshot.payrollRules ?? []).map((r) => ({
      id: r.id,
      staff: profileNameById.get(r.profileId) ?? String(r.profileId ?? '').slice(0, 8),
      payType: PAY_TYPE_LABEL[r.payType] ?? r.payType,
      base: yen(r.baseAmount),
      overtime: `${r.overtimeRate}倍`,
      night: `+${r.nightRate}`,
      holiday: `${r.holidayRate}倍`,
      commute: yen(r.commuteAllowance),
      period: period(r.effectiveFrom, r.effectiveTo),
    })),
    commissionRules: (snapshot.commissionRules ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      target: r.profileId ? profileNameById.get(r.profileId) ?? r.profileId.slice(0, 8) : '全スタッフ',
      method: METHOD_LABEL[r.method] ?? r.method,
      value: r.method === 'rate' && r.rate != null ? `${r.rate}%` : r.method === 'fixed' && r.fixedAmount != null ? yen(r.fixedAmount) : '段階別',
      period: period(r.effectiveFrom, r.effectiveTo),
    })),
  };
}

/** 年末調整の申告の中身（足りない所は空。iPad に渡す形をそろえる） */
export function normalizeNenchoData(raw: unknown): NenchoData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof NenchoData, unknown>>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    dependents: (Array.isArray(d.dependents) ? d.dependents : []).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        name: typeof o.name === 'string' ? o.name : '',
        relation: typeof o.relation === 'string' ? o.relation : '',
        birthDate: typeof o.birthDate === 'string' ? o.birthDate : '',
      };
    }),
    hasSpouse: d.hasSpouse === true,
    spouseIncome: typeof d.spouseIncome === 'number' && Number.isFinite(d.spouseIncome) ? d.spouseIncome : null,
    lifeInsurancePremium: n(d.lifeInsurancePremium),
    earthquakeInsurancePremium: n(d.earthquakeInsurancePremium),
    hasHousingLoanDeduction: d.hasHousingLoanDeduction === true,
    hasPreviousEmploymentIncome: d.hasPreviousEmploymentIncome === true,
    basicDeductionNote: typeof d.basicDeductionNote === 'string' ? d.basicDeductionNote : '',
  };
}

/** 確認する人の一覧で開いたときの中身（Web の components/payroll/nencho-admin-panel.tsx と同じ文言） */
export function nenchoAdminDetail(row: Pick<NenchoAdminRow, 'data' | 'reviewNote' | 'reviewedAt'>) {
  const data = normalizeNenchoData(row.data);
  const lines: { text: string; tone?: 'danger' | 'muted' }[] = [
    { text: `配偶者: ${data.hasSpouse ? `あり（年間所得概算 ${data.spouseIncome?.toLocaleString('ja-JP') ?? '—'}円）` : 'なし'}` },
    { text: `生命保険料: ${data.lifeInsurancePremium.toLocaleString('ja-JP')}円` },
    { text: `地震保険料: ${data.earthquakeInsurancePremium.toLocaleString('ja-JP')}円` },
    { text: `住宅ローン控除: ${data.hasHousingLoanDeduction ? 'あり' : 'なし'}` },
    { text: `前職源泉徴収票: ${data.hasPreviousEmploymentIncome ? 'あり（提出必要）' : 'なし'}` },
  ];
  if (data.basicDeductionNote) lines.push({ text: `基礎控除メモ: ${data.basicDeductionNote}` });
  if (row.reviewNote) lines.push({ text: `差戻し理由: ${row.reviewNote}`, tone: 'danger' });
  if (row.reviewedAt) lines.push({ text: `最終確認: ${formatDateTime(row.reviewedAt)}`, tone: 'muted' });
  return {
    dependents: data.dependents.map((d) => `${d.name}（${d.relation}・${formatDate(d.birthDate)}）`),
    lines,
  };
}
