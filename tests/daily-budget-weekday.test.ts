import { describe, expect, it } from 'vitest';
import { distributeByWeekday, monthDays, monthTotal, weekdayOf, weekdayWeights } from '@/lib/daily-budget';

/** 月の目標を曜日の売上に合わせて日ごとに分ける（2026-09-30 Ronnie「金曜 100万・月曜 40万のように」） */
describe('曜日ごとの日別予算', () => {
  it('曜日ごとの1日あたり売上（売上の無い日は 0 として数える）', () => {
    // 2026-09-07（月）〜 09-13（日）の1週間 ＋ 次の月曜
    const w = weekdayWeights([
      { date: '2026-09-07', sales: 40_000 }, // 月
      { date: '2026-09-11', sales: 100_000 }, // 金
      { date: '2026-09-12', sales: 120_000 }, // 土
      { date: '2026-09-14', sales: 60_000 }, // 月
    ]);
    expect(w[1]).toBe(50_000); // 月：(40,000 + 60,000) ÷ 2
    expect(w[5]).toBe(100_000);
    expect(w[6]).toBe(120_000);
    expect(w[2]).toBe(0); // 火：売上なし（休み）
  });

  it('売上の記録が無ければ全部 0', () => {
    expect(weekdayWeights([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('合計はぴったり目標、よく売れる曜日ほど多い、100円単位', () => {
    const weights = [0, 40, 40, 40, 60, 100, 120]; // 日曜休み
    const daily = distributeByWeekday(15_000_000, '2026-10', weights);
    expect(monthTotal(daily)).toBe(15_000_000);
    const fri = daily['2026-10-02']; // 金
    const mon = daily['2026-10-05']; // 月
    expect(weekdayOf('2026-10-02')).toBe(5);
    expect(fri).toBeGreaterThan(mon * 2);
    expect(daily['2026-10-04']).toBeUndefined(); // 日曜（休み）は予算なし
    for (const v of Object.values(daily)) expect(v % 100).toBe(0);
  });

  it('記録が無ければ毎日同じ（合計はぴったり）', () => {
    const daily = distributeByWeekday(3_000_000, '2026-09', [0, 0, 0, 0, 0, 0, 0]);
    expect(Object.keys(daily)).toHaveLength(monthDays('2026-09').length);
    expect(daily['2026-09-15']).toBe(100_000);
    expect(monthTotal(daily)).toBe(3_000_000);
  });

  it('目標が 0 なら空', () => {
    expect(distributeByWeekday(0, '2026-09', [1, 1, 1, 1, 1, 1, 1])).toEqual({});
  });
});
