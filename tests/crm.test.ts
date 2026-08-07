import { describe, expect, it } from 'vitest';
import { calcLtv, calcRfm, classifyCustomer, type CustomerMetrics } from '@/lib/crm';

const NOW = new Date('2026-08-07T12:00:00+09:00');

const base: CustomerMetrics = {
  visitCount: 0,
  totalSpent: 0,
  cancelCount: 0,
  noShowCount: 0,
  firstVisitAt: null,
  lastVisitAt: null,
};

describe('classifyCustomer（自動分類）', () => {
  it('来店1回以下は新規', () => {
    expect(classifyCustomer({ ...base, visitCount: 1 }, NOW)).toContain('new');
  });
  it('2回以上はリピーター、10回以上は常連', () => {
    expect(classifyCustomer({ ...base, visitCount: 3 }, NOW)).toContain('repeater');
    expect(classifyCustomer({ ...base, visitCount: 12 }, NOW)).toContain('regular');
  });
  it('累計30万円以上はVIP', () => {
    const s = classifyCustomer({ ...base, visitCount: 5, totalSpent: 350_000 }, NOW);
    expect(s).toContain('vip');
  });
  it('最終来店から90日超は休眠', () => {
    const s = classifyCustomer(
      { ...base, visitCount: 4, lastVisitAt: new Date('2026-04-01T00:00:00+09:00') },
      NOW
    );
    expect(s).toContain('dormant');
  });
  it('平均客単価8000円以上は高単価', () => {
    const s = classifyCustomer({ ...base, visitCount: 3, totalSpent: 30_000 }, NOW);
    expect(s).toContain('high_spender');
  });
  it('キャンセル3回以上・無断キャンセル1回以上は注意フラグ', () => {
    expect(classifyCustomer({ ...base, visitCount: 2, cancelCount: 3 }, NOW)).toContain('cancel_risk');
    expect(classifyCustomer({ ...base, visitCount: 2, noShowCount: 1 }, NOW)).toContain('no_show_risk');
  });
  it('複数セグメントが同時に付与される（VIPかつ休眠）', () => {
    const s = classifyCustomer(
      { ...base, visitCount: 15, totalSpent: 500_000, lastVisitAt: new Date('2026-03-01T00:00:00+09:00') },
      NOW
    );
    expect(s).toEqual(expect.arrayContaining(['vip', 'dormant', 'regular']));
  });
});

describe('calcRfm（RFM分析）', () => {
  it('直近来店・高頻度・高額はS（最重要顧客）', () => {
    const r = calcRfm(
      { ...base, visitCount: 25, totalSpent: 400_000, lastVisitAt: new Date('2026-08-01T00:00:00+09:00') },
      NOW
    );
    expect(r).toMatchObject({ recency: 5, frequency: 5, monetary: 5, rank: 'S' });
  });
  it('来店実績なしはD（離反リスク）', () => {
    const r = calcRfm(base, NOW);
    expect(r.rank).toBe('D');
    expect(r.recency).toBe(1);
  });
  it('中間帯: 45日前・6回・6万円 → R3 F3 M3 = B', () => {
    const r = calcRfm(
      { ...base, visitCount: 6, totalSpent: 60_000, lastVisitAt: new Date('2026-06-23T00:00:00+09:00') },
      NOW
    );
    expect(r).toMatchObject({ recency: 3, frequency: 3, monetary: 3, rank: 'B' });
  });
});

describe('calcLtv', () => {
  it('実績LTV = 累計利用額', () => {
    expect(calcLtv({ ...base, visitCount: 1, totalSpent: 5_000 }, NOW).actual).toBe(5_000);
  });
  it('来店2回未満は予測なし', () => {
    expect(calcLtv({ ...base, visitCount: 1, totalSpent: 5_000 }, NOW).projected12m).toBeNull();
  });
  it('12ヶ月予測 = 平均客単価 × 月間頻度 × 12', () => {
    // 6ヶ月で6回来店・計6万円 → 月1回 × 1万円 × 12 = 12万円前後
    const r = calcLtv(
      {
        ...base,
        visitCount: 6,
        totalSpent: 60_000,
        firstVisitAt: new Date('2026-02-07T12:00:00+09:00'),
        lastVisitAt: new Date('2026-08-01T00:00:00+09:00'),
      },
      NOW
    );
    expect(r.avgSpend).toBe(10_000);
    expect(r.projected12m).toBeGreaterThan(100_000);
    expect(r.projected12m).toBeLessThan(140_000);
  });
});
