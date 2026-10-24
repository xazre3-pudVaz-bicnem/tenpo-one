import { cleanDailyBudgets, type DailyBudgetMap } from '@/lib/daily-budget';

/**
 * iPad アプリのネイティブの「日別予算登録」（Web の /app/budgets/daily と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=budgetDaily&month=YYYY-MM、保存は POST { type: 'budgetDailySave', month, values }。
 * 保存の中身は Web と同じ Server Action（saveDailyBudgets：店舗設定に日ごと、月合計は月次予算にも）。
 */
export type NativeBudgetAction =
  | { type: 'budgetDailySave'; month: string; values: DailyBudgetMap }
  /** 予算管理（/app/budgets）の「今月の売上目標」。storeId null＝全社 */
  | { type: 'budgetTargetSave'; storeId: string | null; month: string; amount: number }
  /** 予算管理の「編集」（売上予算・原価率・人件費率・利益・客数・客単価・メモ） */
  | {
      type: 'budgetUpsert';
      storeId: string | null;
      month: string;
      salesBudget: number;
      costRateTarget: number | null;
      laborRateTarget: number | null;
      profitTarget: number | null;
      guestsTarget: number | null;
      avgSpendTarget: number | null;
      note: string | null;
    };

export function isNativeBudgetActionType(v: unknown): v is NativeBudgetAction['type'] {
  return v === 'budgetDailySave' || v === 'budgetTargetSave' || v === 'budgetUpsert';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optNum = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v == null || v === '') return null;
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
};

export function parseNativeBudgetAction(raw: unknown): { ok: true; action: NativeBudgetAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type === 'budgetTargetSave' || b.type === 'budgetUpsert') {
    if (b.storeId != null && !(typeof b.storeId === 'string' && UUID_RE.test(b.storeId))) return { ok: false, error: '店舗が正しくありません' };
    if (typeof b.month !== 'string' || !/^\d{4}-\d{2}-01$/.test(b.month)) return { ok: false, error: '対象月が正しくありません' };
    const storeId = (b.storeId as string | null | undefined) ?? null;
    if (b.type === 'budgetTargetSave') {
      if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 100_000_000_000) return { ok: false, error: '売上目標を正しく入力してください' };
      return { ok: true, action: { type: 'budgetTargetSave', storeId, month: b.month, amount: Math.round(b.amount) } };
    }
    if (typeof b.salesBudget !== 'number' || !Number.isFinite(b.salesBudget) || b.salesBudget < 0 || b.salesBudget > 100_000_000_000) {
      return { ok: false, error: '売上予算を正しく入力してください' };
    }
    const costRateTarget = optNum(b.costRateTarget, 0, 100);
    const laborRateTarget = optNum(b.laborRateTarget, 0, 100);
    const profitTarget = optNum(b.profitTarget, -100_000_000_000, 100_000_000_000);
    const guestsTarget = optNum(b.guestsTarget, 0, 10_000_000);
    const avgSpendTarget = optNum(b.avgSpendTarget, 0, 100_000_000);
    if ([costRateTarget, laborRateTarget, profitTarget, guestsTarget, avgSpendTarget].some((v) => v === undefined)) {
      return { ok: false, error: '目標の数字を正しく入力してください' };
    }
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
    return {
      ok: true,
      action: {
        type: 'budgetUpsert',
        storeId,
        month: b.month,
        salesBudget: b.salesBudget,
        costRateTarget: costRateTarget ?? null,
        laborRateTarget: laborRateTarget ?? null,
        profitTarget: profitTarget ?? null,
        guestsTarget: guestsTarget ?? null,
        avgSpendTarget: avgSpendTarget ?? null,
        note,
      },
    };
  }
  if (b.type !== 'budgetDailySave') return { ok: false, error: '内容が正しくありません' };
  if (typeof b.month !== 'string' || !/^\d{4}-\d{2}$/.test(b.month)) return { ok: false, error: '対象月が正しくありません' };
  if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values)) return { ok: false, error: '金額が正しくありません' };
  const values: DailyBudgetMap = {};
  for (const [k, v] of Object.entries(b.values as Record<string, unknown>)) if (typeof v === 'number') values[k] = v;
  return { ok: true, action: { type: 'budgetDailySave', month: b.month, values: cleanDailyBudgets(values, b.month) } };
}
