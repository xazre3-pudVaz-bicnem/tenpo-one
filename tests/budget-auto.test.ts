import { describe, it, expect } from 'vitest';
import { addDaysStr, buildAutoBudget, monthFactorFromLastYear, type DailySales } from '@/lib/budget-auto';
import { weekdayOf } from '@/lib/daily-budget';

/** from〜to の毎日に、曜日ごとの売上を入れる（日曜は定休＝0） */
function series(from: string, to: string, byWeekday: number[]): DailySales[] {
  const out: DailySales[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push({ date: d, sales: byWeekday[weekdayOf(d)] });
  return out;
}

// 平日 30万・土 50万・金 40万・日 0（定休）
const WEEK = [0, 300_000, 300_000, 300_000, 300_000, 400_000, 500_000];

describe('履歴から日別予算を自動で作る（2026-10-24 Ronnie「日・月・天気で」）', () => {
  it('曜日ごとの売上（直近8週）をそのまま各日に。日曜（売上なし）は入れない', () => {
    const daily = series('2026-08-01', '2026-10-23', WEEK);
    const r = buildAutoBudget({ month: '2026-11', today: '2026-10-24', daily });
    expect(r.monthFactor).toBe(1);
    expect(r.hasLastYear).toBe(false);
    // 2026-11-01 は日曜（定休）→ 入れない、11-02 月曜 30万、11-06 金曜 40万、11-07 土曜 50万
    expect(r.values['2026-11-01']).toBeUndefined();
    expect(r.values['2026-11-02']).toBe(300_000);
    expect(r.values['2026-11-06']).toBe(400_000);
    expect(r.values['2026-11-07']).toBe(500_000);
    expect(r.days.find((d) => d.date === '2026-11-01')?.amount).toBe(0);
    expect(r.baseFrom).toBe('2026-08-29');
    expect(r.baseTo).toBe('2026-10-23');
    expect(r.total).toBe(Object.values(r.values).reduce((a, b) => a + b, 0));
    expect(r.basis).toContain('直近8週');
  });

  it('天気予報：雨の日は ×0.92、雪は ×0.85、100円単位', () => {
    const daily = series('2026-08-01', '2026-10-23', WEEK);
    const r = buildAutoBudget({
      month: '2026-11',
      today: '2026-10-24',
      daily,
      forecast: { '2026-11-02': 'rain', '2026-11-03': 'snow', '2026-11-04': 'sun' },
    });
    expect(r.values['2026-11-02']).toBe(276_000);
    expect(r.values['2026-11-03']).toBe(255_000);
    expect(r.values['2026-11-04']).toBe(300_000);
    expect(r.days.find((d) => d.date === '2026-11-02')?.weather).toBe('rain');
    expect(r.basis).toContain('天気予報');
  });

  it('月の係数：去年の同じ月が、その前の8週より高ければ上げる（上限 1.6・下限 0.6）', () => {
    // 去年：9〜10月は 1日 20万、12月は 1日 30万 → 12月の係数 1.5
    const lastYear = [
      ...series('2025-09-01', '2025-11-30', [200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000]),
      ...series('2025-12-01', '2025-12-31', [300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000]),
    ];
    const recent = series('2026-08-01', '2026-10-23', WEEK);
    const f = monthFactorFromLastYear([...lastYear, ...recent], '2026-12');
    expect(f).toEqual({ factor: 1.5, hasLastYear: true });
    const r = buildAutoBudget({ month: '2026-12', today: '2026-10-24', daily: [...lastYear, ...recent] });
    // 12/1 は火曜 → 30万 × 1.5 = 45万
    expect(r.values['2026-12-01']).toBe(450_000);
    expect(r.basis).toContain('去年の同じ月');
    // 記録が足りない月は 1
    expect(monthFactorFromLastYear(recent, '2026-12')).toEqual({ factor: 1, hasLastYear: false });
    // 極端な差は上限・下限に
    const spike = [
      ...series('2025-09-01', '2025-11-30', [100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000]),
      ...series('2025-12-01', '2025-12-31', [900_000, 900_000, 900_000, 900_000, 900_000, 900_000, 900_000]),
    ];
    expect(monthFactorFromLastYear(spike, '2026-12').factor).toBe(1.6);
  });

  it('記録がまったく無ければ空（0 円の日ばかり）', () => {
    const r = buildAutoBudget({ month: '2026-11', today: '2026-10-24', daily: [] });
    expect(r.values).toEqual({});
    expect(r.total).toBe(0);
  });
});
