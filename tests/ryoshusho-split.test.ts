import { describe, it, expect } from 'vitest';
import {
  isSplitBalanced,
  isSplitCount,
  prorateTax,
  ryoshushoSlips,
  splitAmounts,
  splitLabel,
} from '@/lib/ryoshusho-split';

describe('領収書の分割', () => {
  it('割り切れるときは等分', () => {
    expect(splitAmounts(9000, 3)).toEqual([3000, 3000, 3000]);
  });

  it('端数は先頭の伝票に寄せる', () => {
    expect(splitAmounts(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitAmounts(66300, 4)).toEqual([16575, 16575, 16575, 16575]);
    expect(splitAmounts(1, 2)).toEqual([1, 0]);
  });

  it('分割しても合計は必ず元の金額', () => {
    for (const total of [66300, 7980, 10001, 33333]) {
      for (const n of [2, 3, 4, 5, 7]) {
        expect(splitAmounts(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('枚数の範囲を見る', () => {
    expect(isSplitCount(2)).toBe(true);
    expect(isSplitCount(20)).toBe(true);
    expect(isSplitCount(1)).toBe(false);
    expect(isSplitCount(21)).toBe(false);
    expect(isSplitCount(2.5)).toBe(false);
    expect(isSplitCount('3')).toBe(false);
  });

  it('内消費税は金額の比で按分し、合計は税額と一致する', () => {
    const amounts = [3334, 3333, 3333];
    const taxes = prorateTax(909, amounts);
    expect(taxes.reduce((a, b) => a + b, 0)).toBe(909);
    expect(taxes[0]).toBeGreaterThanOrEqual(taxes[1]);
  });

  it('金額が0でも税の按分で落ちない', () => {
    expect(prorateTax(100, [0, 0])).toEqual([0, 0]);
    expect(prorateTax(0, [])).toEqual([]);
  });

  it('合計が合わない分割は発行させない', () => {
    expect(isSplitBalanced([3334, 3333, 3333], 10000)).toBe(true);
    expect(isSplitBalanced([3334, 3333, 3332], 10000)).toBe(false);
    expect(isSplitBalanced([5000, 0], 5000)).toBe(false);
    expect(isSplitBalanced([5000, -1000], 4000)).toBe(false);
    expect(isSplitBalanced([], 0)).toBe(false);
  });

  it('1枚ずつの内容と通し番号', () => {
    const slips = ryoshushoSlips([16575, 16575, 16575, 16575], 6028);
    expect(slips).toHaveLength(4);
    expect(slips[0].index).toBe(1);
    expect(slips[3].count).toBe(4);
    expect(slips.reduce((a, s) => a + s.amount, 0)).toBe(66300);
    expect(slips.reduce((a, s) => a + s.tax, 0)).toBe(6028);
    expect(splitLabel(slips[1])).toBe('(2/4)');
    expect(splitLabel({ index: 1, count: 1 })).toBe('');
  });
});
