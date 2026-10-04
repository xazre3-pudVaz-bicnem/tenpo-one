import { describe, it, expect } from 'vitest';
import {
  buildDailyTable,
  canEditMonthlyCosts,
  fixedCostTotal,
  isEmptyMonthlyCosts,
  isMonthKey,
  MAX_OTHER_COSTS,
  monthlyCostsFrom,
  monthWindow,
  nextMonth,
  normalizeMonthlyCosts,
  perDayCost,
  prevMonth,
  profitLoss,
  proratedCosts,
  rangeLabel,
  shortDate,
  sumByDate,
  sumInRange,
  thisWeekWindow,
  type MonthlyCosts,
} from '@/lib/monthly-settlement';

const costs = (over: Partial<MonthlyCosts> = {}): MonthlyCosts => ({ rent: 0, electric: 0, water: 0, salary: 0, other: [], ...over });

describe('固定費・給料の読み書き（store_settings.settings.monthlyCosts）', () => {
  it('未設定・壊れた値は全部 0', () => {
    expect(monthlyCostsFrom(null, '2026-09')).toEqual(costs());
    expect(monthlyCostsFrom({ monthlyCosts: 'x' }, '2026-09')).toEqual(costs());
    expect(monthlyCostsFrom({ monthlyCosts: { '2026-09': { rent: 'abc', electric: -5, other: 'no' } } }, '2026-09')).toEqual(costs());
  });

  it('月ごとに読む。文字列の数字も読む。その他は名前のある行だけ、金額は 0 以上の整数', () => {
    const settings = {
      monthlyCosts: {
        '2026-09': { rent: 220000, electric: '35000', water: 8000.4, salary: 1200000, other: [{ name: ' ガス ', amount: 12000 }, { name: '', amount: 5 }, { amount: 3 }] },
      },
    };
    expect(monthlyCostsFrom(settings, '2026-09')).toEqual({ rent: 220000, electric: 35000, water: 8000, salary: 1200000, other: [{ name: 'ガス', amount: 12000 }] });
    expect(monthlyCostsFrom(settings, '2026-10')).toEqual(costs());
  });

  it('その他は上限まで。空かどうかの判定', () => {
    const many = Array.from({ length: MAX_OTHER_COSTS + 5 }, (_, i) => ({ name: `x${i}`, amount: 1 }));
    expect(normalizeMonthlyCosts({ other: many }).other).toHaveLength(MAX_OTHER_COSTS);
    expect(isEmptyMonthlyCosts(costs())).toBe(true);
    expect(isEmptyMonthlyCosts(costs({ water: 1 }))).toBe(false);
    expect(isEmptyMonthlyCosts(costs({ other: [{ name: 'a', amount: 0 }] }))).toBe(false);
  });

  it('固定費の合計は 家賃＋電気＋水道＋その他（給料は別）', () => {
    expect(fixedCostTotal(costs({ rent: 100, electric: 20, water: 5, salary: 999, other: [{ name: 'a', amount: 7 }] }))).toBe(132);
  });

  it('入れられるのは本部で cash.write のある役職だけ', () => {
    expect(canEditMonthlyCosts({ isHq: true, role: 'org_owner' })).toBe(true);
    expect(canEditMonthlyCosts({ isHq: true, role: 'hq_accounting' })).toBe(true);
    expect(canEditMonthlyCosts({ isHq: true, role: 'external_accountant' })).toBe(false);
    expect(canEditMonthlyCosts({ isHq: false, role: 'store_manager' })).toBe(false);
  });
});

describe('日割りと期間', () => {
  it('月の金額を日数で割る（9月=30日・10月=31日）', () => {
    expect(perDayCost(300000, '2026-09')).toBe(10000);
    expect(perDayCost(310000, '2026-10')).toBe(10000);
    expect(perDayCost(0, '2026-10')).toBe(0);
  });

  it('月をまたぐ週は、それぞれの月の日割りを足す', () => {
    const by = (m: string) => (m === '2026-09' ? costs({ rent: 300000, salary: 600000 }) : costs({ rent: 310000, salary: 310000 }));
    // 9/28(月)〜10/4(日): 9月 3日・10月 4日
    const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    expect(proratedCosts(dates, by)).toEqual({ fixed: 3 * 10000 + 4 * 10000, salary: 3 * 20000 + 4 * 10000 });
  });

  it('今週は月曜から今日まで', () => {
    expect(thisWeekWindow('2026-10-04')).toEqual({ first: '2026-09-28', last: '2026-10-04', dates: expect.any(Array) });
    expect(thisWeekWindow('2026-10-04').dates).toHaveLength(7);
    expect(thisWeekWindow('2026-10-05')).toMatchObject({ first: '2026-10-05', last: '2026-10-05' });
    expect(thisWeekWindow('2026-10-05').dates).toEqual(['2026-10-05']);
  });

  it('月の範囲は今日まで（過去の月は月末まで・未来の月は1日だけ）', () => {
    expect(monthWindow('2026-10', '2026-10-04')).toMatchObject({ first: '2026-10-01', last: '2026-10-04', monthLast: '2026-10-31', daysInMonth: 31, inProgress: true });
    expect(monthWindow('2026-10', '2026-10-04').dates).toHaveLength(4);
    expect(monthWindow('2026-09', '2026-10-04')).toMatchObject({ first: '2026-09-01', last: '2026-09-30', daysInMonth: 30, inProgress: false });
    expect(monthWindow('2026-11', '2026-10-04')).toMatchObject({ first: '2026-11-01', last: '2026-11-01', inProgress: true });
  });

  it('前後の月・月のキーの判定・短い日付', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(shortDate('2026-09-01')).toBe('9/1');
    expect(rangeLabel('2026-09-28', '2026-10-04')).toBe('9/28〜10/4');
    expect(rangeLabel('2026-10-05', '2026-10-05')).toBe('10/5');
  });

  it('日別に足す・範囲で足す', () => {
    const m = sumByDate([
      { date: '2026-09-01', amount: 100 },
      { date: '2026-09-01', amount: -30 },
      { date: '2026-09-02', amount: 50 },
    ]);
    expect(m.get('2026-09-01')).toBe(70);
    expect(sumInRange(m, '2026-09-01', '2026-09-01')).toBe(70);
    expect(sumInRange(m, '2026-09-01', '2026-09-30')).toBe(120);
    expect(sumInRange(m, '2026-10-01', '2026-10-31')).toBe(0);
  });
});

describe('損益', () => {
  it('売上 − 仕入 − 経費 − 固定費 − 給料', () => {
    expect(profitLoss({ sales: 2237690, purchases: 863541, expenses: 10000, fixed: 300000, salary: 900000 }).profit).toBe(164149);
    expect(profitLoss({ sales: 100, purchases: 50, expenses: 30, fixed: 40, salary: 0 }).profit).toBe(-20);
  });
});

describe('日付×仕入先の表（スプレッドシートと同じ形）', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
  const sales = new Map([
    ['2026-09-01', 50000],
    ['2026-09-02', 30000],
    ['2026-09-03', 20000],
  ]);
  const purchases = [
    { date: '2026-09-01', vendor: 'Ok market', amount: 9537 },
    { date: '2026-09-01', vendor: "Y'S mart", amount: 933 },
    { date: '2026-09-02', vendor: 'Komaki', amount: 26487 },
    { date: '2026-09-03', vendor: 'Ok market', amount: 17710 },
    { date: '2026-09-03', vendor: 'Ok market', amount: 1000 },
    { date: '2026-09-30', vendor: 'あとの日', amount: 99999 }, // 範囲外は無視
  ];
  const expenses = new Map([['2026-09-01', 520]]);
  const t = buildDailyTable(dates, sales, purchases, expenses);

  it('仕入先の列は金額の多い順。同じ日・同じ仕入先は足す', () => {
    expect(t.vendors).toEqual(['Ok market', 'Komaki', "Y'S mart"]);
    expect(t.rows.map((r) => r.byVendor)).toEqual([
      [9537, 0, 933],
      [0, 26487, 0],
      [18710, 0, 0],
    ]);
    expect(t.rows[0]).toMatchObject({ sales: 50000, expenses: 520, outgo: 9537 + 933 + 520 });
  });

  it('TOTAL と 売上比（%）', () => {
    expect(t.totals).toEqual({ sales: 100000, byVendor: [28247, 26487, 933], expenses: 520, outgo: 56187 });
    expect(t.vendorShare).toEqual([28.25, 26.49, 0.93]);
    expect(t.expensesShare).toBe(0.52);
    expect(t.outgoShare).toBe(56.19);
  });

  it('売上 0 のときの % は null。仕入先なしの請求書は「仕入先なし」の列', () => {
    const e = buildDailyTable(['2026-09-01'], new Map(), [{ date: '2026-09-01', vendor: '  ', amount: 10 }], new Map());
    expect(e.vendors).toEqual(['仕入先なし']);
    expect(e.vendorShare).toEqual([null]);
    expect(e.outgoShare).toBeNull();
  });
});
