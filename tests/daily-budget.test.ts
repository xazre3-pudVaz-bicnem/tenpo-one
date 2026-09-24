import { describe, expect, it } from 'vitest';
import {
  cleanDailyBudgets,
  dailyBudgetsFrom,
  monthDays,
  monthTotal,
  shiftMonth,
  weekdayOf,
  withTax,
  withoutTax,
} from '@/lib/daily-budget';

describe('日別予算（2026-09-25 店舗要望）', () => {
  it('その月の日をすべて出す（うるう年も）', () => {
    expect(monthDays('2026-09')).toHaveLength(30);
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-09')[0]).toBe('2026-09-01');
  });

  it('月を前後に動かせる（年またぎ）', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('曜日（0=日）', () => {
    expect(weekdayOf('2026-09-05')).toBe(6); // 土
    expect(weekdayOf('2026-09-06')).toBe(0); // 日
  });

  it('設定から読むときは、その月の正しい値だけ拾う', () => {
    const settings = {
      dailyBudgets: {
        '2026-09': { '2026-09-01': 120000, '2026-09-02': -5, '2026-09-03': 'abc' },
        '2026-10': { '2026-10-01': 1 },
      },
    };
    expect(dailyBudgetsFrom(settings, '2026-09')).toEqual({ '2026-09-01': 120000 });
    expect(dailyBudgetsFrom(null, '2026-09')).toEqual({});
  });

  it('保存前に、その月以外・0・大きすぎる値を落とす', () => {
    const cleaned = cleanDailyBudgets(
      { '2026-09-01': 1000, '2026-09-02': 0, '2026-10-01': 500, '2026-09-03': 999_999_999 },
      '2026-09'
    );
    expect(cleaned).toEqual({ '2026-09-01': 1000 });
  });

  it('合計と税の計算', () => {
    expect(monthTotal({ a: 100, b: 250 })).toBe(350);
    expect(withoutTax(1100)).toBe(1000);
    expect(withTax(1000)).toBe(1100);
  });
});
