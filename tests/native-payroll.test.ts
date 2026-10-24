import { describe, expect, it } from 'vitest';
import {
  lastMonthRange,
  jstToday,
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
} from '@/lib/native-payroll';
import type { PayrollItemView } from '@/components/payroll/breakdown-panel';

const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';

function item(overrides: Partial<PayrollItemView> = {}): PayrollItemView {
  return {
    id: ID,
    profileName: '山田',
    workDays: 10,
    workMinutes: 600,
    overtimeMinutes: 60,
    nightMinutes: 30,
    holidayMinutes: 0,
    basePay: 12000,
    overtimePay: 1500,
    nightPay: 150,
    holidayPay: 0,
    commutePay: 5000,
    allowanceTotal: 0,
    commissionTotal: 2000,
    grossTotal: 20650,
    breakdown: {
      days: [{ date: '2026-09-01', clockIn: '10:00', clockOut: '20:00', breakMinutes: 60, workMinutes: '9:00', overtimeMinutes: '1:00', nightMinutes: '0:00' }],
      hourlyBase: 1200,
      payType: 'hourly',
      baseAmount: 1200,
      holidayRate: 1.35,
      sales: { taxExcluded: 100000, taxIncluded: 110000 },
      commissions: [{ name: '個人売上歩合', basis: 'tax_excluded', method: 'rate', salesAmount: 100000, rate: 2, amount: 2000 }],
    },
    ...overrides,
  };
}

describe('GET の道（part=payroll）', () => {
  it('何も無ければ一覧、run=<id> は詳細、view=nencho は年末調整', () => {
    expect(parsePayrollView(new URLSearchParams(''))).toEqual({ view: 'list' });
    expect(parsePayrollView(new URLSearchParams(`run=${ID}`))).toEqual({ view: 'run', runId: ID });
    expect(parsePayrollView(new URLSearchParams('view=nencho&year=2025&status=submitted'))).toEqual({ view: 'nencho', year: '2025', status: 'submitted' });
  });

  it('run が UUID でなければだめ', () => {
    expect(parsePayrollView(new URLSearchParams('run=abc'))).toEqual({ error: '内容が正しくありません' });
  });

  it('年末調整の年は Web と同じ（数字なら使う、空・数字でなければ今年）', () => {
    expect(nenchoYearFrom('2025', 2026)).toBe(2025);
    expect(nenchoYearFrom('', 2026)).toBe(2026);
    expect(nenchoYearFrom(null, 2026)).toBe(2026);
    expect(nenchoYearFrom('abc', 2026)).toBe(2026);
  });
});

describe('新規作成の初期値（Web の run-dialog と同じ）', () => {
  it('先月 1 日〜末日（日本時間）', () => {
    // 2026-10-24 は日本時間で 10 月 → 9 月分
    expect(lastMonthRange(new Date('2026-10-24T03:00:00Z'))).toEqual({ start: '2026-09-01', end: '2026-09-30', label: '2026年9月分' });
    // 1 月は前の年の 12 月
    expect(lastMonthRange(new Date('2026-01-10T03:00:00Z'))).toEqual({ start: '2025-12-01', end: '2025-12-31', label: '2025年12月分' });
    // うるう年の 2 月
    expect(lastMonthRange(new Date('2024-03-05T03:00:00Z'))).toEqual({ start: '2024-02-01', end: '2024-02-29', label: '2024年2月分' });
    // UTC ではまだ前の月でも、日本時間で月が変わっていれば日本時間の月で
    expect(lastMonthRange(new Date('2026-10-31T16:00:00Z')).label).toBe('2026年10月分');
  });

  it('今日は日本時間', () => {
    expect(jstToday(new Date('2026-10-24T16:00:00Z'))).toBe('2026-10-25');
  });
});

describe('POST の中身の検証', () => {
  const rule = {
    profileId: ID,
    storeId: null,
    payType: 'hourly',
    baseAmount: 1200,
    overtimeRate: 1.25,
    nightRate: 0.25,
    holidayRate: 1.35,
    commuteAllowance: 500,
    allowances: [{ name: '役職手当', amount: 10000, per: 'month' }],
    closingDay: 31,
    paymentDay: 25,
    effectiveFrom: '2026-10-01',
  };

  it('給与ルール：正しい形はそのまま Server Action へ', () => {
    const p = parsePayrollRuleInput({ rule });
    expect(p).toEqual({ ok: true, value: rule });
    const edit = parsePayrollRuleInput({ rule: { ...rule, id: ID2 } });
    expect(edit.ok && edit.value.id).toBe(ID2);
  });

  it('給与ルール：スタッフ未選択は Server Action の言葉に任せる（空のまま渡す）', () => {
    const p = parsePayrollRuleInput({ rule: { ...rule, profileId: '' } });
    expect(p.ok && p.value.profileId).toBe('');
  });

  it('給与ルール：形がおかしいものは止める', () => {
    expect(parsePayrollRuleInput({ rule: { ...rule, payType: 'weekly' } }).ok).toBe(false);
    expect(parsePayrollRuleInput({ rule: { ...rule, baseAmount: '1200' } }).ok).toBe(false);
    expect(parsePayrollRuleInput({ rule: { ...rule, effectiveFrom: '2026/10/01' } }).ok).toBe(false);
    expect(parsePayrollRuleInput({ rule: { ...rule, storeId: 'x' } }).ok).toBe(false);
    expect(parsePayrollRuleInput({ rule: { ...rule, allowances: [{ name: 'a', amount: 1, per: 'year' }] } }).ok).toBe(false);
  });

  it('歩合ルール：null のまま渡せる・段階料率', () => {
    const r = {
      name: '段階',
      targetType: 'personal_sales',
      profileId: null,
      storeId: ID,
      method: 'tiered',
      rate: null,
      fixedAmount: null,
      tiers: [{ from: 0, to: 300000, rate: 0 }, { from: 300000, to: null, rate: 3 }],
      basis: 'tax_excluded',
      minAmount: null,
      maxAmount: 50000,
      effectiveFrom: '2026-10-01',
    };
    expect(parseCommissionRuleInput({ rule: r })).toEqual({ ok: true, value: r });
    expect(parseCommissionRuleInput({ rule: { ...r, method: 'other' } }).ok).toBe(false);
    expect(parseCommissionRuleInput({ rule: { ...r, tiers: [{ from: 'a', to: null, rate: 1 }] } }).ok).toBe(false);
  });

  it('給与計算・賞与の作成', () => {
    expect(parseCreateRunInput({ title: '9月分', periodStart: '2026-09-01', periodEnd: '2026-09-30', storeId: null })).toEqual({
      ok: true,
      value: { title: '9月分', periodStart: '2026-09-01', periodEnd: '2026-09-30', storeId: null },
    });
    expect(parseCreateRunInput({ title: '9月分', periodStart: '', periodEnd: '2026-09-30', storeId: null }).ok).toBe(false);
    expect(parseCreateBonusRunInput({ title: '賞与', paymentDate: '2026-12-10', storeId: '', items: [{ profileId: ID, amount: 100000 }] })).toEqual({
      ok: true,
      value: { title: '賞与', paymentDate: '2026-12-10', storeId: null, items: [{ profileId: ID, amount: 100000 }] },
    });
    expect(parseCreateBonusRunInput({ title: '賞与', paymentDate: '2026-12-10', storeId: null, items: [{ profileId: 'x', amount: 1 }] }).ok).toBe(false);
  });

  it('年末調整の下書き（中身は Server Action の zod が見る）', () => {
    expect(parseNenchoSave({ year: 2026, data: { dependents: [] } }).ok).toBe(true);
    expect(parseNenchoSave({ year: '2026', data: {} }).ok).toBe(false);
    expect(parseNenchoSave({ year: 2026 }).ok).toBe(false);
  });
});

describe('表示（Web と同じ文言）', () => {
  it('期間（賞与は支給日）', () => {
    expect(runPeriodLabel('salary', '2026-09-01', '2026-09-30', null)).toBe('2026/9/1 〜 2026/9/30');
    expect(runPeriodLabel('bonus', '2026-12-10', '2026-12-10', '2026-12-10')).toBe('支給日: 2026/12/10');
  });

  it('計算根拠', () => {
    const lines = payrollBreakdownLines(item()).map((l) => l.text);
    expect(lines).toEqual([
      '基本給 = 時給¥1,200 × 実働10:00 = ¥12,000',
      '残業代 = 割増基礎時給¥1,200 × 残業1:00 = ¥1,500',
      '深夜手当 = 割増基礎時給¥1,200 × 深夜0:30 = ¥150',
      '交通費 = 10日分 = ¥5,000',
      '歩合（個人売上歩合） = 税抜売上¥100,000 × 2% → ¥2,000',
      '総支給 = ¥20,650',
    ]);
  });

  it('計算根拠：休日・段階料率・店舗目標・期間の内訳', () => {
    const base = item();
    const v = item({
      holidayPay: 1000,
      holidayMinutes: 120,
      breakdown: {
        ...base.breakdown,
        periods: [
          { effectiveFrom: '2026-08-01', effectiveTo: '2026-09-14', rangeStart: '2026-09-01', rangeEnd: '2026-09-14', payType: 'hourly', baseAmount: 1200, hourlyBase: 1200, workDays: 5, basePay: 6000, overtimePay: 0, nightPay: 0, holidayPay: 0 },
          { effectiveFrom: '2026-09-15', effectiveTo: null, rangeStart: '2026-09-15', rangeEnd: '2026-09-30', payType: 'hourly', baseAmount: 1300, hourlyBase: 1300, workDays: 5, basePay: 6500, overtimePay: 1500, nightPay: 0, holidayPay: 0 },
        ],
        commissions: [
          { name: '段階', basis: 'tax_included', method: 'tiered', salesAmount: 400000, tiers: [{ from: 0, to: 300000, rate: 0, bandAmount: 300000, amount: 0 }, { from: 300000, to: null, rate: 3, bandAmount: 100000, amount: 3000 }], amount: 3000 },
          { name: '店舗目標', basis: 'store_target', method: 'fixed', salesAmount: 5000000, achieved: true, amount: 10000 },
        ],
      },
    });
    const lines = payrollBreakdownLines(v);
    expect(lines[0].text).toBe('適用期間の内訳（期間中に給与ルールが変更されています）');
    expect(lines[0].sub).toEqual([
      '適用期間: 2026-09-01〜2026-09-14（ルール適用開始2026-08-01〜2026-09-14） 時給¥1,200 → 基本給¥6,000',
      '適用期間: 2026-09-15〜2026-09-30（ルール適用開始2026-09-15） 時給¥1,300 → 基本給¥6,500／残業代¥1,500',
    ]);
    expect(lines.map((l) => l.text)).toContain('休日手当 = 割増基礎時給¥1,200 × 0.35 × 休日2:00 = ¥1,000');
    const tiered = lines.find((l) => l.text.startsWith('歩合（段階'));
    expect(tiered).toEqual({
      text: '歩合（段階・段階料率） = 税込売上¥400,000',
      sub: ['¥0〜¥300,000：¥300,000 × 0% = ¥0', '¥300,000〜上限なし：¥100,000 × 3% = ¥3,000'],
      tail: '→ 合計 ¥3,000',
    });
    expect(lines.map((l) => l.text)).toContain('ボーナス（店舗目標） = 店舗売上¥5,000,000 ≧ 目標達成 → ¥10,000');
    expect(lines[lines.length - 1]).toEqual({ text: '総支給 = ¥20,650', strong: true });
  });

  it('日別勤怠・合計', () => {
    expect(payrollDayRows(item())).toEqual([
      { date: '2026-09-01', inOut: '10:00〜20:00', work: '9:00', overtime: '1:00', night: '0:00', holiday: '0:00' },
    ]);
    const t = payrollTotals([item(), item({ grossTotal: 1000, workDays: 1 })]);
    expect(t.grossTotal).toBe(21650);
    expect(t.workDays).toBe(11);
  });

  it('承認時に固定したルール', () => {
    const v = snapshotView(
      {
        generatedAt: '2026-10-01T01:00:00Z',
        payrollRules: [
          { id: 'r1', profileId: ID, storeId: null, payType: 'hourly', baseAmount: 1200, overtimeRate: 1.25, nightRate: 0.25, holidayRate: 1.35, commuteAllowance: 500, allowances: [], effectiveFrom: '2026-08-01', effectiveTo: null, closingDay: 31, paymentDay: 25 },
        ],
        commissionRules: [
          { id: 'c1', name: '歩合', targetType: 'personal_sales', profileId: null, storeId: null, method: 'rate', rate: 2, fixedAmount: null, tiers: null, basis: 'tax_excluded', minAmount: null, maxAmount: null, effectiveFrom: '2026-08-01', effectiveTo: null },
        ],
      },
      new Map([[ID, '山田']])
    );
    expect(v.generatedLabel).toBe('記録日時: 2026/10/1 10:00');
    expect(v.payrollRules[0]).toMatchObject({ staff: '山田', payType: '時給', base: '¥1,200', overtime: '1.25倍', night: '+0.25', holiday: '1.35倍', period: '2026/8/1 〜 無期限' });
    expect(v.commissionRules[0]).toMatchObject({ target: '全スタッフ', method: '料率', value: '2%' });
  });

  it('年末調整：足りない所は空でそろえる・確認する人の中身', () => {
    expect(normalizeNenchoData(null)).toEqual({
      dependents: [],
      hasSpouse: false,
      spouseIncome: null,
      lifeInsurancePremium: 0,
      earthquakeInsurancePremium: 0,
      hasHousingLoanDeduction: false,
      hasPreviousEmploymentIncome: false,
      basicDeductionNote: '',
    });
    const d = nenchoAdminDetail({
      data: { ...normalizeNenchoData({}), dependents: [{ name: '花子', relation: '子', birthDate: '2020-04-01' }], hasSpouse: true, spouseIncome: 1000000 },
      reviewNote: '保険料の証明書を',
      reviewedAt: null,
    });
    expect(d.dependents).toEqual(['花子（子・2020/4/1）']);
    expect(d.lines[0].text).toBe('配偶者: あり（年間所得概算 1,000,000円）');
    expect(d.lines.find((l) => l.tone === 'danger')?.text).toBe('差戻し理由: 保険料の証明書を');
  });
});
