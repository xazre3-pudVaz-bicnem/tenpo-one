import { describe, expect, it } from 'vitest';
import { isNativePettyActionType, nativePettyPermission, NATIVE_PETTY_ACTION_TYPES, parseNativePettyAction } from '@/lib/native-petty';

const id = '11111111-1111-4111-8111-111111111111';

describe('native petty / closings actions', () => {
  it('knows its 9 types and permissions', () => {
    expect(NATIVE_PETTY_ACTION_TYPES).toHaveLength(9);
    expect(isNativePettyActionType('pettyAdd')).toBe(true);
    expect(isNativePettyActionType('cashOpen')).toBe(false);
    expect(nativePettyPermission('pettyAdd')).toBe('cash.write');
    expect(nativePettyPermission('pettyReject')).toBe('cash.approve');
    expect(nativePettyPermission('closingReopen')).toBe('register.approve');
    expect(nativePettyPermission('closingReopenStoreDay')).toBeNull();
  });

  it('validates pettyAdd like the web dialog', () => {
    expect(parseNativePettyAction({ type: 'pettyAdd', kind: 'petty_out', amount: 500, purpose: ' 洗剤 ', expenseAccountId: null })).toEqual({
      ok: true,
      action: { type: 'pettyAdd', kind: 'petty_out', amount: 500, purpose: '洗剤', expenseAccountId: null },
    });
    expect(parseNativePettyAction({ type: 'pettyAdd', kind: 'deposit', amount: 500, purpose: 'x' }).ok).toBe(false);
    expect(parseNativePettyAction({ type: 'pettyAdd', kind: 'petty_in', amount: 0, purpose: 'x' }).ok).toBe(false);
    expect(parseNativePettyAction({ type: 'pettyAdd', kind: 'petty_in', amount: 10, purpose: '  ' }).ok).toBe(false);
  });

  it('requires reasons and valid ids/dates', () => {
    expect(parseNativePettyAction({ type: 'pettyReject', id, reason: '' }).ok).toBe(false);
    expect(parseNativePettyAction({ type: 'closingReopen', id, reason: '金額違い' }).ok).toBe(true);
    expect(parseNativePettyAction({ type: 'closingReopenStoreDay', storeId: id, businessDate: '2026-10-24', reason: 'やり直し' }).ok).toBe(true);
    expect(parseNativePettyAction({ type: 'closingReopenStoreDay', storeId: id, businessDate: '24/10', reason: 'x' }).ok).toBe(false);
    expect(parseNativePettyAction({ type: 'pettyCount', countDate: '2026-10-24', expectedAmount: 1000, countedAmount: -1 }).ok).toBe(false);
    expect(parseNativePettyAction({ type: 'pettyOpening', amount: 30000 }).ok).toBe(true);
  });
});
