/**
 * 給与ルール（payroll_rules）の適用期間（effective_from/effective_to）を日単位で解決する純関数群。
 * lib/payroll.ts は変更禁止のため、期間分割ロジックはこのファイルに実装する
 * （app/app/payroll/actions.ts の generatePayrollItems から利用。tests/payroll-periods.test.ts でテスト）。
 *
 * 例: 8/1〜8/14 は時給1300円、8/15〜8/31 は時給1350円のルールが登録されている場合、
 * 期間をまたぐ給与計算では日ごとに適用ルールを選び、ルールごとにグループ化して集計する
 * （8/1〜8/14 の区分と 8/15〜8/31 の区分を別々に計算して合算する）。
 */

export interface PayrollRuleCandidate {
  id: string;
  profileId: string;
  storeId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD。null=無期限
  payType: 'monthly' | 'hourly' | 'daily';
  baseAmount: number;
  overtimeRate: number;
  nightRate: number;
  holidayRate: number;
  commuteAllowance: number;
  allowances: { name: string; amount: number; per: 'month' | 'day' }[];
}

/**
 * 指定スタッフ・指定日に適用すべきルールを1件選ぶ。
 * 優先順位: ①店舗一致ルール ②全店共通ルール(store_id=null) ③同順位内は effective_from が新しい方
 * （店舗run時に店舗別ルールを優先する既存の pickRule と同じ優先順位を日単位に適用したもの）。
 */
export function pickRuleForDate(
  candidates: PayrollRuleCandidate[],
  profileId: string,
  runStoreId: string | null,
  workDate: string
): PayrollRuleCandidate | null {
  const applicable = candidates.filter(
    (r) =>
      r.profileId === profileId &&
      r.effectiveFrom <= workDate &&
      (r.effectiveTo === null || r.effectiveTo >= workDate)
  );
  if (applicable.length === 0) return null;

  const scored = applicable.map((r) => ({
    rule: r,
    score: runStoreId && r.storeId === runStoreId ? 2 : r.storeId === null ? 1 : 0,
  }));
  scored.sort((a, b) => b.score - a.score || b.rule.effectiveFrom.localeCompare(a.rule.effectiveFrom));
  return scored[0].rule;
}

export interface RuleDayGroup<T> {
  rule: PayrollRuleCandidate;
  days: T[];
  /** グループ内の最初の勤務日（表示用） */
  rangeStart: string;
  /** グループ内の最後の勤務日（表示用） */
  rangeEnd: string;
}

export interface GroupDaysResult<T> {
  /** ルールごとのグループ。rule.effectiveFrom の昇順（期間の早い順） */
  groups: RuleDayGroup<T>[];
  /** 適用ルールが見つからなかった勤務日（給与計算の対象外） */
  skippedDates: string[];
}

/**
 * 勤務日配列を、各日に適用されるルールでグルーピングする。
 * 同じルールが適用される日をまとめ、グループを effective_from の昇順で返す
 * （例:「8/1〜8/14 時給1300円」→「8/15〜8/31 時給1350円」の順）。
 */
export function groupDaysByRule<T extends { workDate: string }>(
  days: T[],
  candidates: PayrollRuleCandidate[],
  profileId: string,
  runStoreId: string | null
): GroupDaysResult<T> {
  const sortedDays = [...days].sort((a, b) => a.workDate.localeCompare(b.workDate));

  const daysByRuleId = new Map<string, T[]>();
  const ruleById = new Map<string, PayrollRuleCandidate>();
  const skippedDates: string[] = [];

  for (const day of sortedDays) {
    const rule = pickRuleForDate(candidates, profileId, runStoreId, day.workDate);
    if (!rule) {
      skippedDates.push(day.workDate);
      continue;
    }
    ruleById.set(rule.id, rule);
    const list = daysByRuleId.get(rule.id) ?? [];
    list.push(day);
    daysByRuleId.set(rule.id, list);
  }

  const groups: RuleDayGroup<T>[] = [...daysByRuleId.entries()].map(([ruleId, groupDays]) => {
    const rule = ruleById.get(ruleId) as PayrollRuleCandidate;
    return {
      rule,
      days: groupDays,
      rangeStart: groupDays[0].workDate,
      rangeEnd: groupDays[groupDays.length - 1].workDate,
    };
  });
  groups.sort((a, b) => a.rule.effectiveFrom.localeCompare(b.rule.effectiveFrom));

  return { groups, skippedDates };
}
