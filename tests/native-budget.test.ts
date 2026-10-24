import { describe, expect, it } from 'vitest';
import { isNativeBudgetActionType, parseNativeBudgetAction } from '@/lib/native-budget';

describe('native daily budget', () => {
  it('keeps only valid days of the month', () => {
    expect(isNativeBudgetActionType('budgetDailySave')).toBe(true);
    const r = parseNativeBudgetAction({ type: 'budgetDailySave', month: '2026-10', values: { '2026-10-01': 120000, '2026-10-32': 5, '2026-11-01': 9, '2026-10-02': 0, '2026-10-03': 1.5 } });
    expect(r).toEqual({ ok: true, action: { type: 'budgetDailySave', month: '2026-10', values: { '2026-10-01': 120000 } } });
    expect(parseNativeBudgetAction({ type: 'budgetDailySave', month: '2026/10', values: {} }).ok).toBe(false);
  });
});

describe('native monthly budgets', () => {
  const SID = '11111111-1111-4111-8111-111111111111';
  it('parses the monthly target and the budget edit', () => {
    expect(parseNativeBudgetAction({ type: 'budgetTargetSave', storeId: SID, month: '2026-10-01', amount: 15_000_000.4 })).toEqual({
      ok: true,
      action: { type: 'budgetTargetSave', storeId: SID, month: '2026-10-01', amount: 15_000_000 },
    });
    expect(parseNativeBudgetAction({ type: 'budgetTargetSave', storeId: null, month: '2026-10', amount: 1 }).ok).toBe(false);
    expect(parseNativeBudgetAction({ type: 'budgetTargetSave', storeId: 'x', month: '2026-10-01', amount: 1 }).ok).toBe(false);
    expect(
      parseNativeBudgetAction({ type: 'budgetUpsert', storeId: null, month: '2026-10-01', salesBudget: 1000, costRateTarget: 30, laborRateTarget: '', profitTarget: -5, note: ' ' })
    ).toEqual({
      ok: true,
      action: { type: 'budgetUpsert', storeId: null, month: '2026-10-01', salesBudget: 1000, costRateTarget: 30, laborRateTarget: null, profitTarget: -5, guestsTarget: null, avgSpendTarget: null, note: null },
    });
    expect(parseNativeBudgetAction({ type: 'budgetUpsert', storeId: SID, month: '2026-10-01', salesBudget: 1, costRateTarget: 120 }).ok).toBe(false);
  });
});
