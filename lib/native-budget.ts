import { cleanDailyBudgets, type DailyBudgetMap } from '@/lib/daily-budget';

/**
 * iPad アプリのネイティブの「日別予算登録」（Web の /app/budgets/daily と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=budgetDaily&month=YYYY-MM、保存は POST { type: 'budgetDailySave', month, values }。
 * 保存の中身は Web と同じ Server Action（saveDailyBudgets：店舗設定に日ごと、月合計は月次予算にも）。
 */
export type NativeBudgetAction = { type: 'budgetDailySave'; month: string; values: DailyBudgetMap };

export function isNativeBudgetActionType(v: unknown): v is NativeBudgetAction['type'] {
  return v === 'budgetDailySave';
}

export function parseNativeBudgetAction(raw: unknown): { ok: true; action: NativeBudgetAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type !== 'budgetDailySave') return { ok: false, error: '内容が正しくありません' };
  if (typeof b.month !== 'string' || !/^\d{4}-\d{2}$/.test(b.month)) return { ok: false, error: '対象月が正しくありません' };
  if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values)) return { ok: false, error: '金額が正しくありません' };
  const values: DailyBudgetMap = {};
  for (const [k, v] of Object.entries(b.values as Record<string, unknown>)) if (typeof v === 'number') values[k] = v;
  return { ok: true, action: { type: 'budgetDailySave', month: b.month, values: cleanDailyBudgets(values, b.month) } };
}
