import { describe, expect, it } from 'vitest';
import { handyModifierLabel, parseHandyLine, parseNativeHandyOrderAction } from '@/lib/native-handy-order';

const O = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const X = '33333333-3333-4333-8333-333333333333';

describe('native-handy-order: カートの行', () => {
  it('ふつうの商品・選択肢・メモ・金額入力', () => {
    expect(parseHandyLine({ menuItemId: M, optionItemIds: [X], quantity: 2, name: ' 唐揚げ ', memo: ' 辛め ' })).toEqual({
      menuItemId: M,
      optionItemIds: [X],
      quantity: 2,
      name: '唐揚げ',
      openPrice: null,
      memo: '辛め',
    });
    expect(parseHandyLine({ menuItemId: M, quantity: 1, name: '延長', openPrice: 500 })?.openPrice).toBe(500);
  });
  it('その他（金額入力）の行', () => {
    const l = parseHandyLine({ menuItemId: 'custom-1', quantity: 1, name: 'その他', custom: { categoryId: null, price: 800, memo: '持ち込み' } });
    expect(l?.custom).toEqual({ categoryId: null, price: 800, memo: '持ち込み' });
  });
  it('おかしい行は null', () => {
    expect(parseHandyLine({ menuItemId: 'x', quantity: 1 })).toBeNull();
    expect(parseHandyLine({ menuItemId: M, quantity: 0 })).toBeNull();
    expect(parseHandyLine({ menuItemId: M, quantity: 21 })).toBeNull();
    expect(parseHandyLine({ menuItemId: M, quantity: 1.5 })).toBeNull();
    expect(parseHandyLine({ menuItemId: M, quantity: 1, optionItemIds: ['x'] })).toBeNull();
    expect(parseHandyLine({ menuItemId: M, quantity: 1, openPrice: -1 })).toBeNull();
    expect(parseHandyLine({ quantity: 1, custom: { categoryId: 'bad', price: 100 } })).toBeNull();
    expect(parseHandyLine(null)).toBeNull();
  });
});

describe('native-handy-order: 操作', () => {
  it('送信', () => {
    const r = parseNativeHandyOrderAction({ type: 'handySubmit', orderId: O, lines: [{ menuItemId: M, quantity: 1, name: 'A' }] });
    expect(r.ok && r.action.type === 'handySubmit' && r.action.lines.length).toBe(1);
    expect(parseNativeHandyOrderAction({ type: 'handySubmit', orderId: O, lines: [] }).ok).toBe(false);
    expect(parseNativeHandyOrderAction({ type: 'handySubmit', orderId: O, lines: [{ menuItemId: 'x', quantity: 1 }] }).ok).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ menuItemId: M, quantity: 1, name: 'A' }));
    expect(parseNativeHandyOrderAction({ type: 'handySubmit', orderId: O, lines: many }).ok).toBe(false);
  });
  it('卓・人数・延長・取消・会計伝票', () => {
    expect(parseNativeHandyOrderAction({ type: 'handyOpenOrder', tableId: O }).ok).toBe(true);
    expect(parseNativeHandyOrderAction({ type: 'handyOpenOrder', tableId: 'x' }).ok).toBe(false);
    expect(parseNativeHandyOrderAction({ type: 'handyGuests', orderId: O, guestCount: 4 }).ok).toBe(true);
    expect(parseNativeHandyOrderAction({ type: 'handyGuests', orderId: O, guestCount: 0 }).ok).toBe(false);
    expect(parseNativeHandyOrderAction({ type: 'handyExtend', orderId: O, minutes: 30 }).ok).toBe(true);
    expect(parseNativeHandyOrderAction({ type: 'handyExtend', orderId: O, minutes: 45 }).ok).toBe(false);
    expect(parseNativeHandyOrderAction({ type: 'handyCancelItem', orderId: O, orderItemId: M }).ok).toBe(true);
    expect(parseNativeHandyOrderAction({ type: 'handyPrintBill', orderId: O }).ok).toBe(true);
    expect(parseNativeHandyOrderAction({ type: 'nope' }).ok).toBe(false);
  });
  it('選択肢のラベル', () => {
    expect(handyModifierLabel([{ name: '大盛り' }, { name: 'チーズ' }])).toBe('大盛り・チーズ');
    expect(handyModifierLabel([])).toBeNull();
    expect(handyModifierLabel(null)).toBeNull();
  });
});
