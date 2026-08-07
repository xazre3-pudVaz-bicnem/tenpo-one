/**
 * 人件費の概算（レポート・ダッシュボード共通）。
 * 「時給ルール×実働の概算」: 時給者=時給×実働時間 / 日給者=日給×出勤日数 /
 * 月給者=月給÷21日×出勤日数（日割り）。残業・深夜・休日割増や手当は含まない簡易計算。
 * lib/payroll.ts の summarizeEntry（休憩控除後の実働分数の算出）を利用する。
 */
import { summarizeEntry, type TimeEntryLike } from '@/lib/payroll';

export interface TimeEntryForLabor {
  profile_id: string;
  store_id: string;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_minutes: number;
  entry_type: string;
}

export interface PayrollRuleForLabor {
  profile_id: string;
  store_id: string | null; // null = 全店共通
  pay_type: 'monthly' | 'hourly' | 'daily';
  base_amount: number;
  effective_from: string;
  effective_to: string | null;
}

function buildRuleIndex(rules: PayrollRuleForLabor[]): Map<string, PayrollRuleForLabor[]> {
  const map = new Map<string, PayrollRuleForLabor[]>();
  for (const r of rules) {
    const list = map.get(r.profile_id);
    if (list) list.push(r);
    else map.set(r.profile_id, [r]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return map;
}

/** 対象日・店舗に有効なルールを選ぶ（当店専用ルールを優先し、無ければ全店共通ルール） */
function pickRule(
  candidates: PayrollRuleForLabor[] | undefined,
  storeId: string,
  workDate: string
): PayrollRuleForLabor | null {
  if (!candidates) return null;
  const eligible = candidates.filter(
    (r) => r.effective_from <= workDate && (r.effective_to == null || r.effective_to >= workDate)
  );
  return eligible.find((r) => r.store_id === storeId) ?? eligible.find((r) => r.store_id == null) ?? null;
}

export interface LaborCostResult {
  total: number;
  /** 有効な給与ルールが見つからず概算から除外した勤務件数（注記用） */
  missingRuleCount: number;
  /** 打刻漏れ（出勤のみで退勤未打刻）の件数（注記・アラート用） */
  openEntryCount: number;
}

export function estimateLaborCost(entries: TimeEntryForLabor[], rules: PayrollRuleForLabor[]): LaborCostResult {
  const ruleIndex = buildRuleIndex(rules);
  let total = 0;
  let missingRuleCount = 0;
  let openEntryCount = 0;

  for (const e of entries) {
    if (!e.clock_in_at || !e.clock_out_at) {
      if (e.clock_in_at && !e.clock_out_at) openEntryCount += 1;
      continue;
    }
    const rule = pickRule(ruleIndex.get(e.profile_id), e.store_id, e.work_date);
    if (!rule) {
      missingRuleCount += 1;
      continue;
    }
    const day = summarizeEntry({
      clockInAt: new Date(e.clock_in_at),
      clockOutAt: new Date(e.clock_out_at),
      breakMinutes: e.break_minutes,
      isHolidayWork: e.entry_type === 'holiday_work',
    } satisfies TimeEntryLike);

    if (rule.pay_type === 'hourly') {
      total += Math.floor((rule.base_amount * day.workMinutes) / 60);
    } else if (rule.pay_type === 'daily') {
      total += rule.base_amount;
    } else {
      total += Math.floor(rule.base_amount / 21);
    }
  }

  return { total, missingRuleCount, openEntryCount };
}
