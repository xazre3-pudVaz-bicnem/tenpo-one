/**
 * 給与・歩合の試算ロジック（純関数・テスト対象）。
 * 税金・社会保険・年末調整は対象外（画面にもその旨を明示する）。
 * 深夜時間帯 = 22:00〜翌5:00 / 残業 = 1日8時間超
 */

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 5;
export const DAILY_STANDARD_MINUTES = 8 * 60;

export interface TimeEntryLike {
  clockInAt: Date;
  clockOutAt: Date;
  breakMinutes: number;
}

export interface DayAttendance {
  workMinutes: number; // 休憩控除後
  overtimeMinutes: number; // 8時間超
  nightMinutes: number; // 22-5時の勤務（休憩は日中から控除したとみなす簡易計算）
}

/** 1勤務の実働・残業・深夜時間を分単位で集計する */
export function summarizeEntry(entry: TimeEntryLike): DayAttendance {
  const totalMinutes = Math.max(
    0,
    Math.floor((entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 60000) - entry.breakMinutes
  );
  const overtimeMinutes = Math.max(0, totalMinutes - DAILY_STANDARD_MINUTES);

  // 深夜時間: 1分刻みで判定（UTC+9時間でJSTの時刻を算出）
  let nightMinutes = 0;
  const cursor = new Date(entry.clockInAt);
  const end = entry.clockOutAt;
  while (cursor < end) {
    const jstHour = new Date(cursor.getTime() + 9 * 3600000).getUTCHours();
    if (jstHour >= NIGHT_START_HOUR || jstHour < NIGHT_END_HOUR) nightMinutes++;
    cursor.setTime(cursor.getTime() + 60000);
  }
  nightMinutes = Math.min(nightMinutes, totalMinutes);
  return { workMinutes: totalMinutes, overtimeMinutes, nightMinutes };
}

export interface PayrollRuleLike {
  payType: 'monthly' | 'hourly' | 'daily';
  baseAmount: number;
  overtimeRate: number; // 1.25
  nightRate: number; // 0.25（加算分）
  commuteAllowance: number; // 円/日
  allowances: { name: string; amount: number; per: 'month' | 'day' }[];
}

export interface PayrollPreview {
  workDays: number;
  workMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  basePay: number;
  overtimePay: number;
  nightPay: number;
  commutePay: number;
  allowanceTotal: number;
  commissionTotal: number;
  grossTotal: number;
  hourlyBase: number; // 割増計算の基礎時給
}

/**
 * 期間の勤怠集計から支給試算を作成する。
 * 月給者の割増基礎時給 = 月給 / (21日 × 8h) の簡易計算（open-questions.md 参照）
 */
export function calcPayroll(
  rule: PayrollRuleLike,
  days: DayAttendance[],
  commissionTotal: number
): PayrollPreview {
  const workDays = days.length;
  const workMinutes = days.reduce((a, d) => a + d.workMinutes, 0);
  const overtimeMinutes = days.reduce((a, d) => a + d.overtimeMinutes, 0);
  const nightMinutes = days.reduce((a, d) => a + d.nightMinutes, 0);

  let basePay = 0;
  let hourlyBase = 0;
  if (rule.payType === 'monthly') {
    basePay = rule.baseAmount;
    hourlyBase = Math.floor(rule.baseAmount / (21 * 8));
  } else if (rule.payType === 'daily') {
    basePay = rule.baseAmount * workDays;
    hourlyBase = Math.floor(rule.baseAmount / 8);
  } else {
    hourlyBase = rule.baseAmount;
    basePay = Math.floor((rule.baseAmount * workMinutes) / 60);
  }

  // 残業割増: 時給者は基本給に1.0倍分が含まれるため差分(rate-1)を加算。月給者は全額加算
  const overtimeMultiplier = rule.payType === 'hourly' ? rule.overtimeRate - 1 : rule.overtimeRate;
  const overtimePay = Math.floor((hourlyBase * overtimeMultiplier * overtimeMinutes) / 60);
  const nightPay = Math.floor((hourlyBase * rule.nightRate * nightMinutes) / 60);
  const commutePay = rule.commuteAllowance * workDays;
  const allowanceTotal = rule.allowances.reduce(
    (a, al) => a + (al.per === 'month' ? al.amount : al.amount * workDays),
    0
  );

  const grossTotal = basePay + overtimePay + nightPay + commutePay + allowanceTotal + commissionTotal;
  return {
    workDays, workMinutes, overtimeMinutes, nightMinutes,
    basePay, overtimePay, nightPay, commutePay, allowanceTotal,
    commissionTotal, grossTotal, hourlyBase,
  };
}

export interface CommissionRuleLike {
  targetType: 'personal_sales' | 'menu_item' | 'category' | 'store_target' | 'nomination';
  method: 'fixed' | 'rate' | 'tiered';
  rate?: number | null; // %
  fixedAmount?: number | null;
  tiers?: { from: number; to: number | null; rate: number }[] | null;
  minAmount?: number | null;
  maxAmount?: number | null;
}

/** 売上金額（basis適用済み）に歩合ルールを適用する */
export function calcCommission(rule: CommissionRuleLike, salesAmount: number): number {
  let result = 0;
  if (rule.method === 'fixed') {
    result = rule.fixedAmount ?? 0;
  } else if (rule.method === 'rate') {
    result = Math.floor((salesAmount * (rule.rate ?? 0)) / 100);
  } else if (rule.method === 'tiered' && rule.tiers) {
    // 段階料率: 各帯域の売上部分に帯域ごとの料率を適用
    for (const tier of rule.tiers) {
      const upper = tier.to ?? Infinity;
      if (salesAmount <= tier.from) continue;
      const bandAmount = Math.min(salesAmount, upper) - tier.from;
      result += Math.floor((bandAmount * tier.rate) / 100);
    }
  }
  if (rule.minAmount != null) result = Math.max(result, rule.minAmount);
  if (rule.maxAmount != null) result = Math.min(result, rule.maxAmount);
  return result;
}
