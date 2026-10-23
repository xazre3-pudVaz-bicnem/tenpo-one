import { describe, it, expect } from 'vitest';
import { isNativeQuickActionType, NATIVE_QUICK_ACTION_TYPES, parseNativeQuickAction } from '@/lib/native-quick';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('ネイティブの即会計（2026-10-24）', () => {
  it('形', () => {
    expect(NATIVE_QUICK_ACTION_TYPES.length).toBe(3);
    expect(isNativeQuickActionType('quickCheckout')).toBe(true);
    expect(parseNativeQuickAction({ type: 'nope' }).ok).toBe(false);
  });
  it('会計：金額の行・値引・割引', () => {
    const r = parseNativeQuickAction({ type: 'quickCheckout', orderId: null, guestCount: 2, lines: [{ amount: 530, quantity: 2 }], discount: { kind: 'percent', value: 10 } });
    expect(r.ok).toBe(true);
    expect(parseNativeQuickAction({ type: 'quickCheckout', orderId: null, guestCount: 1, lines: [] }).ok).toBe(false);
    expect(parseNativeQuickAction({ type: 'quickCheckout', orderId: U1, guestCount: 1, lines: [] }).ok).toBe(true);
    expect(parseNativeQuickAction({ type: 'quickCheckout', orderId: null, lines: [{ amount: 0, quantity: 1 }] }).ok).toBe(false);
    expect(parseNativeQuickAction({ type: 'quickCheckout', orderId: null, lines: [{ amount: 100, quantity: 100 }] }).ok).toBe(false);
    expect(parseNativeQuickAction({ type: 'quickCheckout', orderId: null, lines: [{ amount: 100, quantity: 1 }], discount: { kind: 'percent', value: 120 } }).ok).toBe(false);
  });
});
