import { describe, it, expect } from 'vitest';
import { NATIVE_EXPENSE_ACTION_TYPES, parseNativeExpenseAction } from '@/lib/native-expenses';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('ネイティブの仕入・経費（2026-10-24）', () => {
  it('形', () => {
    expect(NATIVE_EXPENSE_ACTION_TYPES.length).toBe(5);
    expect(parseNativeExpenseAction({ type: 'x' }).ok).toBe(false);
  });
  it('経費：科目・金額・支払元・営業日', () => {
    expect(parseNativeExpenseAction({ type: 'expenseAdd', expenseAccountId: U1, amount: 5000, taxAmount: 0, paidVia: 'petty_cash', businessDate: '2026-10-24' }).ok).toBe(true);
    expect(parseNativeExpenseAction({ type: 'expenseAdd', expenseAccountId: U1, amount: 0, paidVia: 'petty_cash', businessDate: '2026-10-24' }).ok).toBe(false);
    expect(parseNativeExpenseAction({ type: 'expenseAdd', expenseAccountId: U1, amount: 10, paidVia: 'card', businessDate: '2026-10-24' }).ok).toBe(false);
  });
  it('仕入の請求書・差戻し', () => {
    expect(parseNativeExpenseAction({ type: 'expenseBill', vendorName: 'Komaki', amount: 9537, date: '2026-10-24' }).ok).toBe(true);
    expect(parseNativeExpenseAction({ type: 'expenseBill', vendorName: ' ', amount: 9537, date: '2026-10-24' }).ok).toBe(false);
    expect(parseNativeExpenseAction({ type: 'expenseReject', id: U1, reason: '' }).ok).toBe(false);
  });
});
