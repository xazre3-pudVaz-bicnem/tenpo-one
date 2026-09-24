import { describe, expect, it } from 'vitest';
import {
  allowsTakeoutItem,
  cleanTakeoutItemIds,
  filterTakeoutItems,
  isTakeoutLikeOrder,
  takeoutMenuFrom,
} from '@/lib/takeout-menu';

describe('isTakeoutLikeOrder', () => {
  it('テイクアウト・デリバリー・事前注文は同じ扱い', () => {
    expect(isTakeoutLikeOrder('takeout')).toBe(true);
    expect(isTakeoutLikeOrder('delivery')).toBe(true);
    expect(isTakeoutLikeOrder('pre_order')).toBe(true);
    expect(isTakeoutLikeOrder('dine_in')).toBe(false);
    expect(isTakeoutLikeOrder(null)).toBe(false);
  });
});

describe('takeoutMenuFrom', () => {
  it('壊れた値は捨てる', () => {
    expect(takeoutMenuFrom(null).itemIds).toEqual([]);
    expect(takeoutMenuFrom({ takeoutMenu: { itemIds: 'a' } }).itemIds).toEqual([]);
    expect(takeoutMenuFrom({ takeoutMenu: { itemIds: ['a', 'a', '', 3, 'b'] } }).itemIds).toEqual(['a', 'b']);
  });
});

describe('filterTakeoutItems', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('未設定のときは1つも出さない（店内メニューが紛れ込まない）', () => {
    expect(filterTakeoutItems(items, { itemIds: [] })).toEqual([]);
  });

  it('入れた商品だけ出す', () => {
    expect(filterTakeoutItems(items, { itemIds: ['b', 'zzz'] })).toEqual([{ id: 'b' }]);
  });
});

describe('allowsTakeoutItem', () => {
  it('入れていない商品は打てない', () => {
    expect(allowsTakeoutItem({ itemIds: ['a'] }, 'a')).toBe(true);
    expect(allowsTakeoutItem({ itemIds: ['a'] }, 'b')).toBe(false);
    expect(allowsTakeoutItem({ itemIds: [] }, 'a')).toBe(false);
  });
});

describe('cleanTakeoutItemIds', () => {
  it('重複を取り、配列以外は空にする', () => {
    expect(cleanTakeoutItemIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(cleanTakeoutItemIds('a')).toEqual([]);
  });
});
