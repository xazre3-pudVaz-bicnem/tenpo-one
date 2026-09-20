import { describe, it, expect } from 'vitest';
import {
  CASH_DENOMINATIONS,
  denominationLabel,
  denominationSubtotal,
  sumDenominations,
  hasAnyCount,
} from '@/lib/cash-count';

describe('CASH_DENOMINATIONS', () => {
  it('現場が数える順（1円から1万円）に並んでいる', () => {
    expect([...CASH_DENOMINATIONS]).toEqual([1, 5, 10, 50, 100, 500, 1000, 5000, 10000]);
  });
});

describe('denominationLabel', () => {
  it('硬貨と紙幣で言い方を変える', () => {
    expect(denominationLabel(1)).toBe('1円');
    expect(denominationLabel(500)).toBe('500円');
    expect(denominationLabel(1000)).toBe('1,000円札');
    expect(denominationLabel(10000)).toBe('10,000円札');
  });
});

describe('denominationSubtotal', () => {
  it('金種×枚数', () => {
    expect(denominationSubtotal(10000, 3)).toBe(30000);
    expect(denominationSubtotal(1, 7)).toBe(7);
  });

  it('未入力・不正値は0として扱う（入力途中で合計が壊れないように）', () => {
    expect(denominationSubtotal(500, undefined)).toBe(0);
    expect(denominationSubtotal(500, null)).toBe(0);
    expect(denominationSubtotal(500, -3)).toBe(0);
    expect(denominationSubtotal(500, Number.NaN)).toBe(0);
  });

  it('小数は切り捨てる（枚数に小数はない）', () => {
    expect(denominationSubtotal(100, 2.9)).toBe(200);
  });
});

describe('sumDenominations', () => {
  it('全金種を合計する', () => {
    const counts = { 1: 3, 5: 1, 10: 2, 50: 1, 100: 4, 500: 2, 1000: 5, 5000: 1, 10000: 2 };
    // 3 + 5 + 20 + 50 + 400 + 1000 + 5000 + 5000 + 20000
    expect(sumDenominations(counts)).toBe(31478);
  });

  it('空なら0', () => {
    expect(sumDenominations({})).toBe(0);
  });
});

describe('hasAnyCount', () => {
  it('1枚でも入っていればtrue', () => {
    expect(hasAnyCount({ 1: 1 })).toBe(true);
    expect(hasAnyCount({})).toBe(false);
  });

  it('0と入力した金種があれば入力済みとみなす（実査額0円のレジも締められるように）', () => {
    expect(hasAnyCount({ 10000: 0 })).toBe(true);
    expect(hasAnyCount({ 1: 0 })).toBe(true);
  });
});
