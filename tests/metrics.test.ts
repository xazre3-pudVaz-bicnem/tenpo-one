import { describe, expect, it } from 'vitest';
import {
  computeSalesMetrics,
  computeCostVariance,
  expectedCash,
  refundableAmount,
} from '@/lib/metrics';
import { buildRefundJournal, validateJournalBalance, STD } from '@/lib/accounting';

describe('売上指標の正式定義（gross/refunds/net）', () => {
  it('部分返金: 売上10,000 − 返金3,000 = 純売上7,000（元取引は上書きしない）', () => {
    const m = computeSalesMetrics(
      [{ total: 10000, guest_count: 2, status: 'paid' }],
      [{ amount: 3000 }]
    );
    expect(m.grossSales).toBe(10000);
    expect(m.refunds).toBe(3000);
    expect(m.netSales).toBe(7000);
    expect(m.avgSpend).toBe(3500); // net基準: 7000÷2名
  });
  it('全額返金: gross・件数・客数に残り、netは0になる', () => {
    const m = computeSalesMetrics(
      [{ total: 5000, guest_count: 1, status: 'refunded' }],
      [{ amount: 5000 }]
    );
    expect(m.grossSales).toBe(5000);
    expect(m.netSales).toBe(0);
    expect(m.transactionCount).toBe(1);
    expect(m.guests).toBe(1);
  });
  it('複数回部分返金の累積', () => {
    const m = computeSalesMetrics(
      [{ total: 10000, guest_count: 4 }],
      [{ amount: 3000 }, { amount: 2000 }]
    );
    expect(m.refunds).toBe(5000);
    expect(m.netSales).toBe(5000);
    expect(m.avgSpend).toBe(1250);
  });
  it('VOID（取引取消）は返金と区別して集計される', () => {
    const m = computeSalesMetrics(
      [{ total: 8000 }, { total: 2000 }],
      [{ amount: 2000, kind: 'void' }, { amount: 1000, kind: 'refund' }]
    );
    expect(m.refunds).toBe(3000);
    expect(m.voidAmount).toBe(2000);
    expect(m.netSales).toBe(7000);
  });
  it('返金なし・客数0でも壊れない', () => {
    const m = computeSalesMetrics([], []);
    expect(m.netSales).toBe(0);
    expect(m.avgSpend).toBe(0);
  });
});

describe('返金可能額', () => {
  it('支払10,000・返金済み3,000 → 最大返金可能額7,000', () => {
    expect(refundableAmount(10000, 3000)).toBe(7000);
  });
  it('全額返金済みなら0（負にならない）', () => {
    expect(refundableAmount(10000, 10000)).toBe(0);
    expect(refundableAmount(10000, 12000)).toBe(0);
  });
});

describe('理論現金（レジ締め）', () => {
  it('開始3万 + 現金売上5万 + 入金1万 − 現金返金3千 − 小口出金2千 = 85,000', () => {
    expect(
      expectedCash({ openingFloat: 30000, cashSales: 50000, cashIn: 10000, cashRefunds: 3000, cashOut: 2000 })
    ).toBe(85000);
  });
  it('カード返金は現金残高へ影響しない（cashRefundsに含めない前提の式）', () => {
    const base = expectedCash({ openingFloat: 30000, cashSales: 50000, cashIn: 0, cashRefunds: 0, cashOut: 0 });
    expect(base).toBe(80000);
  });
});

describe('返金仕訳（貸借一致・現金/売掛の区別）', () => {
  it('現金返金3,000（標準税率）: 借方売上高/貸方現金', () => {
    const lines = buildRefundJournal({
      cashRefundsStandard: 3000, cashRefundsReduced: 0,
      cashlessRefundsStandard: 0, cashlessRefundsReduced: 0,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: STD.sales, side: 'debit', amount: 3000 });
    expect(lines[1]).toMatchObject({ accountCode: STD.cash, side: 'credit', amount: 3000 });
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
  it('カード返金は売掛金の減少（貸方売掛金）', () => {
    const lines = buildRefundJournal({
      cashRefundsStandard: 0, cashRefundsReduced: 0,
      cashlessRefundsStandard: 5000, cashlessRefundsReduced: 0,
    });
    expect(lines.find((l) => l.side === 'credit')?.accountCode).toBe(STD.receivable);
    expect(validateJournalBalance(lines).balanced).toBe(true);
  });
  it('現金+カード+軽減税率混在でも貸借一致', () => {
    const lines = buildRefundJournal({
      cashRefundsStandard: 2000, cashRefundsReduced: 800,
      cashlessRefundsStandard: 3000, cashlessRefundsReduced: 200,
    });
    const v = validateJournalBalance(lines);
    expect(v.balanced).toBe(true);
    expect(v.debit).toBe(6000);
  });
});

describe('理論原価と実原価（混同しない）', () => {
  it('理論30万 + 廃棄2万 + 棚卸差異1万 = 実原価33万・差異+3万・差異率10%', () => {
    const v = computeCostVariance({
      theoreticalCost: 300_000,
      wasteAmount: 20_000,
      countAdjustmentAmount: 10_000,
    });
    expect(v.actualCost).toBe(330_000);
    expect(v.variance).toBe(30_000);
    expect(v.varianceRate).toBeCloseTo(10);
    expect(v.breakdown).toEqual({ waste: 20_000, countAdjustment: 10_000, other: 0 });
  });
  it('棚卸で在庫が多かった場合（負の調整）は実原価が理論を下回る', () => {
    const v = computeCostVariance({
      theoreticalCost: 100_000,
      wasteAmount: 0,
      countAdjustmentAmount: -5_000,
    });
    expect(v.actualCost).toBe(95_000);
    expect(v.variance).toBe(-5_000);
  });
  it('理論原価0でも差異率は0（ゼロ除算なし）', () => {
    expect(computeCostVariance({ theoreticalCost: 0, wasteAmount: 100, countAdjustmentAmount: 0 }).varianceRate).toBe(0);
  });
});
