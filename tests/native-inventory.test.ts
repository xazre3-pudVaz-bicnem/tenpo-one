import { describe, expect, it } from 'vitest';
import { isNativeInventoryActionType, nativeInventoryPermission, parseNativeInventoryAction } from '@/lib/native-inventory';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('native inventory', () => {
  it('knows its action types and permissions', () => {
    expect(isNativeInventoryActionType('invItemCreate')).toBe(true);
    expect(isNativeInventoryActionType('stockSave')).toBe(false);
    expect(nativeInventoryPermission('invMovement')).toBe('inventory.write');
    expect(nativeInventoryPermission('invCountSave')).toBe('inventory.write');
    expect(nativeInventoryPermission('invTransferShip')).toBe('vendors.manage');
  });

  it('parses item create / update like the web form', () => {
    const ok = parseNativeInventoryAction({
      type: 'invItemCreate', name: ' 鶏もも ', itemKind: 'ingredient', category: '', unit: 'g', initialQuantity: 500,
      reorderPoint: 200, minQuantity: null, optimalQuantity: '', avgCost: 2, purchaseUnit: 'kg', purchaseToStockFactor: 1000,
    });
    expect(ok).toEqual({
      ok: true,
      action: {
        type: 'invItemCreate', name: '鶏もも', itemKind: 'ingredient', category: null, unit: 'g', initialQuantity: 500,
        reorderPoint: 200, minQuantity: null, optimalQuantity: null, avgCost: 2, purchaseUnit: 'kg', purchaseToStockFactor: 1000,
      },
    });
    expect(parseNativeInventoryAction({ type: 'invItemCreate', name: '', itemKind: 'ingredient', purchaseToStockFactor: 1 })).toEqual({ ok: false, error: '名前を入力してください' });
    expect(parseNativeInventoryAction({ type: 'invItemCreate', name: 'a', itemKind: 'ingredient', purchaseToStockFactor: 0 })).toEqual({ ok: false, error: '変換係数は正の数で入力してください' });
    expect(parseNativeInventoryAction({ type: 'invItemCreate', name: 'a', itemKind: 'x', purchaseToStockFactor: 1 }).ok).toBe(false);
    expect(parseNativeInventoryAction({ type: 'invItemCreate', name: 'a', itemKind: 'supply', reorderPoint: -1, purchaseToStockFactor: 1 }).ok).toBe(false);
    const up = parseNativeInventoryAction({ type: 'invItemUpdate', id: ID, name: 'a', itemKind: 'supply', unit: '', purchaseToStockFactor: 1 });
    expect(up.ok && up.action.type === 'invItemUpdate' && up.action.unit).toBe('個');
    expect(parseNativeInventoryAction({ type: 'invItemUpdate', id: 'x', name: 'a', itemKind: 'supply', purchaseToStockFactor: 1 }).ok).toBe(false);
  });

  it('parses movements (receipt needs a unit cost)', () => {
    expect(parseNativeInventoryAction({ type: 'invMovement', itemId: ID, movementType: 'in', quantity: 2, unitCost: 1200, reason: '' })).toEqual({
      ok: true,
      action: { type: 'invMovement', itemId: ID, movementType: 'in', quantity: 2, reason: null, unitCost: 1200 },
    });
    expect(parseNativeInventoryAction({ type: 'invMovement', itemId: ID, movementType: 'in', quantity: 2, unitCost: null }).ok).toBe(false);
    expect(parseNativeInventoryAction({ type: 'invMovement', itemId: ID, movementType: 'waste', quantity: 0 }).ok).toBe(false);
    expect(parseNativeInventoryAction({ type: 'invMovement', itemId: ID, movementType: 'sale', quantity: 1 }).ok).toBe(false);
  });

  it('parses counts and transfers', () => {
    expect(parseNativeInventoryAction({ type: 'invCountStart' })).toEqual({ ok: true, action: { type: 'invCountStart' } });
    expect(parseNativeInventoryAction({ type: 'invCountSave', countId: ID, entries: [{ id: ID2, countedQuantity: 3 }], finalize: true })).toEqual({
      ok: true,
      action: { type: 'invCountSave', countId: ID, entries: [{ id: ID2, countedQuantity: 3 }], finalize: true },
    });
    expect(parseNativeInventoryAction({ type: 'invCountSave', countId: ID, entries: [{ id: ID2, countedQuantity: -1 }] }).ok).toBe(false);
    expect(parseNativeInventoryAction({ type: 'invTransferRequest', toStoreId: ID, note: ' ', lines: [{ inventoryItemId: ID2, quantity: 2 }] })).toEqual({
      ok: true,
      action: { type: 'invTransferRequest', toStoreId: ID, note: null, lines: [{ inventoryItemId: ID2, quantity: 2 }] },
    });
    expect(parseNativeInventoryAction({ type: 'invTransferCancel', id: ID, reason: '' })).toEqual({ ok: false, error: '理由を入力してください' });
    expect(parseNativeInventoryAction({ type: 'invTransferShip', id: ID })).toEqual({ ok: true, action: { type: 'invTransferShip', id: ID } });
    expect(parseNativeInventoryAction({ type: 'invTransferDirect', fromItemId: ID, toStoreId: ID2, quantity: 0 }).ok).toBe(false);
  });
});
