import { describe, expect, it } from 'vitest';
import {
  calcChange, calcOrderTotals, taxFromExclusive, taxFromInclusive, validatePayments,
} from '@/lib/money';

describe('taxFromInclusive（内税額）', () => {
  it('税込1100円・10% → 税額100円', () => {
    expect(taxFromInclusive(1100, 10)).toBe(100);
  });
  it('税込1080円・8% → 税額80円', () => {
    expect(taxFromInclusive(1080, 8)).toBe(80);
  });
  it('割り切れない金額は本体を切り捨てて税額を求める（税込999円・10%）', () => {
    // 999 / 1.1 = 908.18… → 本体908円、税額91円
    expect(taxFromInclusive(999, 10)).toBe(91);
  });
  it('金額が整数でなければ例外', () => {
    expect(() => taxFromInclusive(100.5, 10)).toThrow();
  });
});

describe('taxFromExclusive（外税額）', () => {
  it('税抜1000円・10% → 100円', () => {
    expect(taxFromExclusive(1000, 10)).toBe(100);
  });
  it('端数は切り捨て（税抜101円・8% → 8円）', () => {
    expect(taxFromExclusive(101, 8)).toBe(8);
  });
});

describe('calcOrderTotals', () => {
  it('内税商品のみの合計', () => {
    const t = calcOrderTotals([
      { unitPrice: 650, quantity: 2, taxRate: 10, taxIncluded: true },
      { unitPrice: 1480, quantity: 1, taxRate: 10, taxIncluded: true },
    ]);
    expect(t.grossItems).toBe(2780);
    expect(t.total).toBe(2780);
    expect(t.taxTotal).toBe(taxFromInclusive(1300, 10) + taxFromInclusive(1480, 10));
    expect(t.subtotal + t.taxTotal).toBe(t.grossItems);
  });

  it('外税商品は税額を加算する', () => {
    const t = calcOrderTotals([{ unitPrice: 1000, quantity: 1, taxRate: 10, taxIncluded: false }]);
    expect(t.grossItems).toBe(1100);
    expect(t.taxTotal).toBe(100);
  });

  it('値引きは合計から差し引かれ、0円未満にならない', () => {
    const t = calcOrderTotals([{ unitPrice: 500, quantity: 1, taxRate: 10, taxIncluded: true }], {
      discount: 800,
    });
    expect(t.discount).toBe(500);
    expect(t.total).toBe(0);
  });

  it('サービス料10%は税込合計に対して切り捨てで加算', () => {
    const t = calcOrderTotals([{ unitPrice: 999, quantity: 1, taxRate: 10, taxIncluded: true }], {
      serviceChargeRate: 10,
    });
    expect(t.serviceCharge).toBe(99);
    expect(t.total).toBe(1098);
  });

  it('トッピング金額は数量分加算される', () => {
    const t = calcOrderTotals([
      { unitPrice: 880, quantity: 2, taxRate: 10, taxIncluded: true, modifiersTotal: 100 },
    ]);
    expect(t.grossItems).toBe(1960);
  });
});

describe('validatePayments / calcChange', () => {
  it('複数支払方法の合計が請求額と一致すればOK', () => {
    expect(validatePayments(5000, [{ amount: 3000 }, { amount: 2000 }])).toBe(true);
  });
  it('不一致・0円以下・非整数はNG', () => {
    expect(validatePayments(5000, [{ amount: 3000 }])).toBe(false);
    expect(validatePayments(5000, [{ amount: 5000.5 }])).toBe(false);
    expect(validatePayments(0, [{ amount: 0 }])).toBe(false);
  });
  it('お釣り計算', () => {
    expect(calcChange(3280, 5000)).toBe(1720);
    expect(calcChange(3280, 3000)).toBe(0);
  });
});
