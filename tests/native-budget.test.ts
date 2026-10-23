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
