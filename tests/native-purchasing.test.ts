import { describe, expect, it } from 'vitest';
import { isNativePurchasingActionType, parseNativePurchasingAction } from '@/lib/native-purchasing';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('native purchasing', () => {
  it('knows its action types', () => {
    expect(isNativePurchasingActionType('poCreate')).toBe(true);
    expect(isNativePurchasingActionType('invMovement')).toBe(false);
  });

  it('parses vendor save / delete like the web form', () => {
    const r = parseNativePurchasingAction({ type: 'vendorSave', name: ' 青果店 ', nameKana: '', closingDay: 31, paymentDay: null, email: 'a@b.jp' });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'vendorSave',
        id: null,
        input: { name: '青果店', nameKana: null, contactName: null, phone: null, email: 'a@b.jp', address: null, closingDay: 31, paymentDay: null, bankInfo: null, note: null },
      },
    });
    expect(parseNativePurchasingAction({ type: 'vendorSave', name: '' })).toEqual({ ok: false, error: '名前を入力してください' });
    expect(parseNativePurchasingAction({ type: 'vendorSave', name: 'a', closingDay: 32 }).ok).toBe(false);
    expect(parseNativePurchasingAction({ type: 'vendorDelete', id: ID, reason: '' })).toEqual({ ok: false, error: '理由を入力してください' });
    expect(parseNativePurchasingAction({ type: 'vendorDelete', id: ID, reason: '取引終了' }).ok).toBe(true);
  });

  it('parses a purchase order', () => {
    const r = parseNativePurchasingAction({
      type: 'poCreate', vendorId: ID, expectedAt: '2026-10-30', note: '',
      lines: [{ inventoryItemId: ID2, name: '鶏もも', quantity: 5, unit: 'kg', unitCost: 1200.4, taxRate: 8 }, { inventoryItemId: null, name: '箸', quantity: 1, unit: '', unitCost: 0, taxRate: 10 }],
    });
    expect(r).toEqual({
      ok: true,
      action: {
        type: 'poCreate', vendorId: ID, expectedAt: '2026-10-30', note: null,
        lines: [
          { inventoryItemId: ID2, name: '鶏もも', quantity: 5, unit: 'kg', unitCost: 1200, taxRate: 8 },
          { inventoryItemId: null, name: '箸', quantity: 1, unit: '個', unitCost: 0, taxRate: 10 },
        ],
      },
    });
    expect(parseNativePurchasingAction({ type: 'poCreate', vendorId: ID, lines: [] }).ok).toBe(false);
    expect(parseNativePurchasingAction({ type: 'poCreate', vendorId: ID, lines: [{ name: 'a', quantity: 1, unitCost: 1, taxRate: 5 }] }).ok).toBe(false);
    expect(parseNativePurchasingAction({ type: 'poCreate', vendorId: 'x', lines: [{ name: 'a', quantity: 1, unitCost: 1, taxRate: 10 }] }).ok).toBe(false);
  });

  it('parses status, cancel and receive', () => {
    expect(parseNativePurchasingAction({ type: 'poStatus', id: ID, action: 'approve' })).toEqual({ ok: true, action: { type: 'poStatus', id: ID, action: 'approve' } });
    expect(parseNativePurchasingAction({ type: 'poStatus', id: ID, action: 'receive' }).ok).toBe(false);
    expect(parseNativePurchasingAction({ type: 'poCancel', id: ID, reason: '誤発注' }).ok).toBe(true);
    expect(parseNativePurchasingAction({ type: 'poReceive', id: ID, receipts: [{ itemId: ID2, quantity: 2, unitCost: 100 }] })).toEqual({
      ok: true,
      action: { type: 'poReceive', id: ID, receipts: [{ itemId: ID2, quantity: 2, unitCost: 100 }] },
    });
    expect(parseNativePurchasingAction({ type: 'poReceive', id: ID, receipts: [] })).toEqual({ ok: false, error: '入荷数量を入力してください' });
  });
});
