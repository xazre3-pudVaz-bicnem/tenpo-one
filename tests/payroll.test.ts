import { describe, expect, it } from 'vitest';
import { calcCommission, calcPayroll, summarizeEntry } from '@/lib/payroll';

describe('summarizeEntry（勤怠集計）', () => {
  it('休憩を控除した実働時間', () => {
    const r = summarizeEntry({
      clockInAt: new Date('2026-08-01T10:00:00+09:00'),
      clockOutAt: new Date('2026-08-01T19:00:00+09:00'),
      breakMinutes: 60,
    });
    expect(r.workMinutes).toBe(480);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.nightMinutes).toBe(0);
  });

  it('8時間超は残業', () => {
    const r = summarizeEntry({
      clockInAt: new Date('2026-08-01T10:00:00+09:00'),
      clockOutAt: new Date('2026-08-01T21:00:00+09:00'),
      breakMinutes: 60,
    });
    expect(r.workMinutes).toBe(600);
    expect(r.overtimeMinutes).toBe(120);
  });

  it('22時以降は深夜時間としてカウント', () => {
    const r = summarizeEntry({
      clockInAt: new Date('2026-08-01T18:00:00+09:00'),
      clockOutAt: new Date('2026-08-02T00:00:00+09:00'),
      breakMinutes: 0,
    });
    expect(r.nightMinutes).toBe(120);
  });
});

describe('calcPayroll（給与試算）', () => {
  const hourlyRule = {
    payType: 'hourly' as const,
    baseAmount: 1300,
    overtimeRate: 1.25,
    nightRate: 0.25,
    commuteAllowance: 500,
    allowances: [],
  };

  it('時給者: 基本給 = 時給 × 実働時間', () => {
    const p = calcPayroll(hourlyRule, [{ workMinutes: 480, overtimeMinutes: 0, nightMinutes: 0 }], 0);
    expect(p.basePay).toBe(1300 * 8);
    expect(p.commutePay).toBe(500);
    expect(p.grossTotal).toBe(1300 * 8 + 500);
  });

  it('時給者の残業は差分(0.25)を加算（基本給に1.0倍分が含まれるため）', () => {
    const p = calcPayroll(hourlyRule, [{ workMinutes: 600, overtimeMinutes: 120, nightMinutes: 0 }], 0);
    expect(p.basePay).toBe(1300 * 10);
    expect(p.overtimePay).toBe(Math.floor(1300 * 0.25 * 2));
  });

  it('深夜割増は0.25倍を加算', () => {
    const p = calcPayroll(hourlyRule, [{ workMinutes: 480, overtimeMinutes: 0, nightMinutes: 120 }], 0);
    expect(p.nightPay).toBe(Math.floor(1300 * 0.25 * 2));
  });

  it('月給者: 割増基礎時給 = 月給/(21×8)、残業は全額加算', () => {
    const p = calcPayroll(
      {
        ...hourlyRule,
        payType: 'monthly',
        baseAmount: 336000,
        allowances: [{ name: '役職手当', amount: 30000, per: 'month' }],
      },
      [{ workMinutes: 540, overtimeMinutes: 60, nightMinutes: 0 }],
      0
    );
    expect(p.hourlyBase).toBe(2000);
    expect(p.basePay).toBe(336000);
    expect(p.overtimePay).toBe(2500); // 2000 × 1.25 × 1h
    expect(p.allowanceTotal).toBe(30000);
  });

  it('歩合が総支給へ加算される', () => {
    const p = calcPayroll(hourlyRule, [{ workMinutes: 480, overtimeMinutes: 0, nightMinutes: 0 }], 12000);
    expect(p.grossTotal).toBe(1300 * 8 + 500 + 12000);
  });

  it('休日出勤: 時給者は差分(1.35-1)を加算', () => {
    const p = calcPayroll(
      { ...hourlyRule, holidayRate: 1.35 },
      [{ workMinutes: 480, overtimeMinutes: 0, nightMinutes: 0, holidayMinutes: 480 }],
      0
    );
    expect(p.holidayPay).toBe(3640); // 時給1300×0.35×8h
    expect(p.holidayMinutes).toBe(480);
  });

  it('休日出勤フラグ付きの勤怠は全実働が休日時間になる', () => {
    const r = summarizeEntry({
      clockInAt: new Date('2026-08-02T10:00:00+09:00'),
      clockOutAt: new Date('2026-08-02T18:00:00+09:00'),
      breakMinutes: 60,
      isHolidayWork: true,
    });
    expect(r.holidayMinutes).toBe(420);
  });
});

describe('calcCommission（歩合計算）', () => {
  it('率方式: 売上の2%切り捨て', () => {
    expect(calcCommission({ targetType: 'personal_sales', method: 'rate', rate: 2 }, 123456)).toBe(2469);
  });

  it('固定方式', () => {
    expect(calcCommission({ targetType: 'store_target', method: 'fixed', fixedAmount: 10000 }, 0)).toBe(10000);
  });

  it('段階料率: 帯域ごとに適用', () => {
    const rule = {
      targetType: 'personal_sales' as const,
      method: 'tiered' as const,
      tiers: [
        { from: 0, to: 500000, rate: 1 },
        { from: 500000, to: null, rate: 3 },
      ],
    };
    // 80万 → 50万×1% + 30万×3% = 5000 + 9000
    expect(calcCommission(rule, 800000)).toBe(14000);
  });

  it('上限・下限の適用', () => {
    expect(
      calcCommission({ targetType: 'personal_sales', method: 'rate', rate: 10, maxAmount: 5000 }, 100000)
    ).toBe(5000);
    expect(
      calcCommission({ targetType: 'personal_sales', method: 'rate', rate: 1, minAmount: 3000 }, 10000)
    ).toBe(3000);
  });
});
