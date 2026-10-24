import { describe, expect, it } from 'vitest';
import { isNativeCouponActionType, parseNativeCouponAction } from '@/lib/native-coupons';

const ID = '11111111-1111-4111-8111-111111111111';

describe('native coupons', () => {
  it('parses save / status / code', () => {
    expect(isNativeCouponActionType('couponSave')).toBe(true);
    expect(parseNativeCouponAction({ type: 'couponCode' })).toEqual({ ok: true, action: { type: 'couponCode' } });
    expect(parseNativeCouponAction({ type: 'couponStatus', id: ID, status: 'paused' })).toEqual({ ok: true, action: { type: 'couponStatus', id: ID, status: 'paused' } });
    expect(parseNativeCouponAction({ type: 'couponStatus', id: ID, status: 'x' }).ok).toBe(false);
    const r = parseNativeCouponAction({
      type: 'couponSave', code: 'summer10', name: '夏', kind: 'percent', value: 10, storeId: null, minTotal: 0,
      startsAt: '2026-10-24T03:00:00.000Z', endsAt: null, timeFrom: '17:00', timeTo: null, maxUses: 100, perCustomerLimit: '', firstVisitOnly: true,
    });
    expect(r.ok && r.action.type === 'couponSave' && r.action.input).toEqual({
      id: undefined, code: 'summer10', name: '夏', kind: 'percent', value: 10, storeId: null, targetCategoryId: null, targetMenuItemId: null,
      minTotal: 0, startsAt: '2026-10-24T03:00:00.000Z', endsAt: null, timeFrom: '17:00', timeTo: null, maxUses: 100, perCustomerLimit: null,
      firstVisitOnly: true, stackable: false,
    });
    expect(parseNativeCouponAction({ type: 'couponSave', kind: 'fixed', value: 1, timeFrom: '25:00' }).ok).toBe(false);
    expect(parseNativeCouponAction({ type: 'couponSave', kind: 'fixed', value: 1, maxUses: 0 }).ok).toBe(false);
  });
});
