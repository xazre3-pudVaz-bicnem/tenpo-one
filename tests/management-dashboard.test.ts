import { describe, expect, it } from 'vitest';
import { calendarWeeks, parseMonthKey, shiftMonthKey, summarizeManagement, type DayFact } from '@/lib/management-dashboard';

const stores = [
  { id: 'a', name: 'A店' },
  { id: 'b', name: 'B店' },
];

function fact(storeId: string, date: string, sales: number, extra: Partial<DayFact> = {}): DayFact {
  return { storeId, date, sales, guests: 10, groups: 4, cost: 0, labor: 0, expenses: 0, ...extra };
}

describe('management-dashboard: 月のまとめ', () => {
  const base = {
    month: '2026-10',
    today: '2026-10-24',
    stores,
    budgets: [
      { storeId: 'a', salesBudget: 3_100_000, costRateTarget: 30, laborRateTarget: 25, profitTarget: 500_000 },
      { storeId: 'b', salesBudget: 1_550_000, costRateTarget: 36, laborRateTarget: 31, profitTarget: 100_000 },
    ],
    dailyBudget: (storeId: string) => (storeId === 'a' ? 100_000 : 50_000),
    fixedPerDay: (storeId: string) => (storeId === 'a' ? 10_000 : 0),
    useOrgBudget: true,
  };

  it('店舗ごとの売上・原価率・人件費率・営業利益（固定費の日割り込み）', () => {
    const r = summarizeManagement({
      ...base,
      facts: [fact('a', '2026-10-01', 200_000, { cost: 60_000, labor: 40_000, expenses: 10_000 }), fact('b', '2026-10-02', 100_000, { cost: 40_000 })],
    });
    const a = r.stores[0];
    expect(a.sales).toBe(200_000);
    expect(a.cost).toBe(60_000);
    expect(a.costRatePct).toBe(30);
    expect(a.laborRatePct).toBe(20);
    // 固定費 10,000 × 今日まで 24 日
    expect(a.fixed).toBe(240_000);
    expect(a.profit).toBe(200_000 - 60_000 - 40_000 - 10_000 - 240_000);
    expect(a.avgSpend).toBe(20_000);
    const b = r.stores[1];
    expect(b.costRatePct).toBe(40);
    expect(b.laborRatePct).toBe(0);
    expect(b.fixed).toBe(0);
  });

  it('予算：月の達成率と、今日までのペース', () => {
    const r = summarizeManagement({ ...base, facts: [fact('a', '2026-10-01', 1_200_000)] });
    const a = r.stores[0];
    expect(a.budget).toBe(3_100_000);
    expect(a.achievementPct).toBe(39); // 1.2M / 3.1M
    expect(a.paceBudget).toBe(100_000 * 24);
    expect(a.pacePct).toBe(50);
    // 合計は店舗の行の合計（会社の行なし）
    expect(r.total.budget).toBe(4_650_000);
    expect(r.total.paceBudget).toBe(150_000 * 24);
    expect(r.total.sales).toBe(1_200_000);
  });

  it('会社の予算行があれば全店舗はそれを使う（日割り）', () => {
    const r = summarizeManagement({
      ...base,
      budgets: [...base.budgets, { storeId: null, salesBudget: 6_200_000, costRateTarget: 33, laborRateTarget: null, profitTarget: 900_000 }],
      facts: [fact('a', '2026-10-01', 1_000_000)],
    });
    expect(r.total.budget).toBe(6_200_000);
    expect(r.total.paceBudget).toBe(200_000 * 24);
    expect(r.targets.costRateTarget).toBe(33);
    expect(r.targets.profitTarget).toBe(900_000);
    // 人件費率の目標は会社の行に無いので店舗の重み付け平均：(25×3.1M + 31×1.55M) / 4.65M = 27
    expect(r.targets.laborRateTarget).toBe(27);
    // カレンダーの予算も会社の日割り
    expect(r.days[0].budget).toBe(200_000);
  });

  it('目標：会社の行が無ければ店舗の行を予算で重み付け、利益は合計', () => {
    const r = summarizeManagement({ ...base, facts: [] });
    expect(r.targets.costRateTarget).toBe(32); // (30×3.1 + 36×1.55)/4.65 = 32
    expect(r.targets.profitTarget).toBe(600_000);
  });

  it('カレンダー：過去と今日は実績、未来は予算だけ', () => {
    const r = summarizeManagement({ ...base, facts: [fact('a', '2026-10-24', 90_000), fact('a', '2026-10-25', 999)] });
    expect(r.days).toHaveLength(31);
    expect(r.daysInMonth).toBe(31);
    expect(r.daysElapsed).toBe(24);
    const today = r.days.find((d) => d.date === '2026-10-24')!;
    expect(today.isToday).toBe(true);
    expect(today.sales).toBe(90_000);
    expect(today.budget).toBe(150_000);
    expect(today.achievementPct).toBe(60);
    const tomorrow = r.days.find((d) => d.date === '2026-10-25')!;
    expect(tomorrow.isFuture).toBe(true);
    expect(tomorrow.sales).toBe(0);
    expect(tomorrow.achievementPct).toBeNull();
    expect(tomorrow.budget).toBe(150_000);
  });

  it('店舗を 1 つ選んでいるときは会社の行を使わない', () => {
    const r = summarizeManagement({
      ...base,
      stores: [stores[0]],
      useOrgBudget: false,
      budgets: [...base.budgets, { storeId: null, salesBudget: 6_200_000, costRateTarget: 33, laborRateTarget: null, profitTarget: null }],
      facts: [],
    });
    expect(r.total.budget).toBe(3_100_000);
    expect(r.targets.costRateTarget).toBe(30);
  });
});

describe('management-dashboard: カレンダーと月', () => {
  it('月曜はじまりで週に分ける（2026-10 は木曜はじまり）', () => {
    const cells = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    const weeks = calendarWeeks(cells);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0][3]?.date).toBe('2026-10-01');
    expect(weeks[4][5]?.date).toBe('2026-10-31');
    expect(weeks[4][6]).toBeNull();
  });
  it('前後の月・?month= の読み取り', () => {
    expect(shiftMonthKey('2026-10', -1)).toBe('2026-09');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(parseMonthKey('2026-09', '2026-10-24')).toBe('2026-09');
    expect(parseMonthKey('2026-13', '2026-10-24')).toBe('2026-10');
    expect(parseMonthKey(undefined, '2026-10-24')).toBe('2026-10');
  });
});
