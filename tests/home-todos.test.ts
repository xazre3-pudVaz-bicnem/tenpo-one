import { describe, expect, it } from 'vitest';
import {
  budgetAchievement,
  buildHomeTodos,
  buildRegisterDiffNotices,
  countReservationTodos,
  countUnscannedWithdrawals,
  dailyBudgetFromMonthly,
  findUnclosedPreviousMonth,
  formatDayDelta,
  pettyAdvanceBalance,
  previousMonthOf,
  summarizeRepeatRate,
} from '@/lib/home-todos';

describe('buildHomeTodos', () => {
  it('0件・未指定のものは出さない', () => {
    expect(buildHomeTodos({})).toEqual([]);
    expect(buildHomeTodos({ inboxDocuments: 0, overdueInvoices: 0, pettyAdvanceBalance: 0, unclosedMonth: null })).toEqual([]);
  });
  it('件数のあるものだけを所定の順で出す', () => {
    const todos = buildHomeTodos({
      today: '2026-09-17',
      lowStockItems: 3,
      unscannedWithdrawals: 1,
      inboxDocuments: 2,
      overdueInvoices: 1,
      unassignedReservations: 1,
      pendingReservations: 4,
      unclosedMonth: '2026-08',
    });
    expect(todos.map((t) => t.key)).toEqual([
      'unscanned',
      'inbox',
      'overdue',
      'pending-resv',
      'unassigned-resv',
      'low-stock',
      'month-close',
    ]);
    expect(todos.find((t) => t.key === 'low-stock')?.count).toBe(3);
    expect(todos.find((t) => t.key === 'month-close')?.label).toBe('2026年8月 月次締め');
    expect(todos.find((t) => t.key === 'pending-resv')?.href).toBe('/app/reservations?date=2026-09-17');
  });
  it('仮払い未精算は金額で表示する', () => {
    const [t] = buildHomeTodos({ pettyAdvanceBalance: 12500 });
    expect(t.key).toBe('advance');
    expect(t.valueLabel).toBe('¥12,500');
    expect(t.href).toBe('/app/cash?tab=petty');
  });
  it('不正な月は月次締めを出さない', () => {
    expect(buildHomeTodos({ unclosedMonth: '2026/08' })).toEqual([]);
  });
});

describe('月次締め', () => {
  it('前月を返す（年跨ぎ）', () => {
    expect(previousMonthOf('2026-09-17')).toBe('2026-08');
    expect(previousMonthOf('2026-01-05')).toBe('2025-12');
  });
  it('月次締めを使っていない企業には出さない', () => {
    expect(findUnclosedPreviousMonth([], '2026-09-17')).toBeNull();
    expect(findUnclosedPreviousMonth([{ month: '2026-08-01', status: 'open' }], '2026-09-17')).toBeNull();
  });
  it('前月が未締めなら対象月を返す', () => {
    const periods = [{ month: '2026-07-01', status: 'closed' }];
    expect(findUnclosedPreviousMonth(periods, '2026-09-17')).toBe('2026-08');
    expect(findUnclosedPreviousMonth([...periods, { month: '2026-08-01', status: 'open' }], '2026-09-17')).toBe('2026-08');
  });
  it('前月が締め済みなら null', () => {
    expect(findUnclosedPreviousMonth([{ month: '2026-08-01', status: 'closed' }], '2026-09-17')).toBeNull();
  });
});

describe('現金まわり', () => {
  it('立替残高 = 立替 − 精算（負にしない）', () => {
    expect(
      pettyAdvanceBalance([
        { kind: 'petty_advance', amount: 5000 },
        { kind: 'petty_advance', amount: 3000 },
        { kind: 'petty_settlement', amount: 5000 },
        { kind: 'petty_out', amount: 999 },
      ])
    ).toBe(3000);
    expect(pettyAdvanceBalance([{ kind: 'petty_settlement', amount: 100 }])).toBe(0);
  });
  it('レシート未紐付けの出金だけを数える（入金・取消・差戻しは除外）', () => {
    expect(
      countUnscannedWithdrawals([
        { kind: 'withdrawal', receipt_document_id: null, status: 'active', approval_status: 'approved' },
        { kind: 'petty_out', receipt_document_id: null, status: 'active', approval_status: 'pending' },
        { kind: 'petty_out', receipt_document_id: 'doc-1', status: 'active', approval_status: 'approved' },
        { kind: 'deposit', receipt_document_id: null, status: 'active', approval_status: 'approved' },
        { kind: 'withdrawal', receipt_document_id: null, status: 'void', approval_status: 'approved' },
        { kind: 'withdrawal', receipt_document_id: null, status: 'active', approval_status: 'rejected' },
      ])
    ).toBe(2);
  });
  it('レジ締めの差額を注意事項にする（差額0・未締めは除外、新しい順）', () => {
    const notices = buildRegisterDiffNotices([
      { business_date: '2026-09-15', closed_at: '2026-09-15T13:00:00Z', difference: -300, register_name: 'レジ1' },
      { business_date: '2026-09-16', closed_at: '2026-09-16T12:42:00Z', difference: 1200, store_name: '新宿店' },
      { business_date: '2026-09-16', closed_at: '2026-09-16T12:50:00Z', difference: 0 },
      { business_date: '2026-09-17', closed_at: null, difference: 500 },
    ]);
    expect(notices).toHaveLength(2);
    expect(notices[0].message).toBe('9/16 のレジ締め（新宿店）で現金過剰 ¥1,200 を検出。');
    expect(notices[1].message).toBe('9/15 のレジ締め（レジ1）で現金不足 ¥300 を検出。');
    expect(notices[0].href).toBe('/app/cash?tab=closings');
  });
  it('しきい値未満の差額は出さない', () => {
    expect(buildRegisterDiffNotices([{ business_date: '2026-09-16', closed_at: 'x', difference: 50 }], 100)).toEqual([]);
  });
});

describe('予約', () => {
  it('未確定（pending）と席未定（pending/confirmed でテーブルなし）を数える', () => {
    expect(
      countReservationTodos([
        { status: 'pending', table_count: 0 },
        { status: 'pending', table_count: 1 },
        { status: 'confirmed', table_count: 0 },
        { status: 'seated', table_count: 0 },
        { status: 'confirmed', table_count: 2 },
      ])
    ).toEqual({ pending: 2, unassigned: 2 });
  });
});

describe('summarizeRepeatRate', () => {
  const customers = [
    { id: 'a', first_visit_date: '2026-01-10', visit_count: 5 },
    { id: 'b', first_visit_date: '2026-09-17', visit_count: 1 },
    { id: 'c', first_visit_date: null, visit_count: 3 },
    { id: 'd', first_visit_date: null, visit_count: 1 },
  ];
  it('初回来店日が本日より前ならリピーター、同一顧客は1名として数える', () => {
    expect(summarizeRepeatRate(['a', 'a', 'b', null, 'c', 'd'], customers, '2026-09-17')).toEqual({
      repeaters: 2,
      newcomers: 2,
      ratePct: 50,
    });
  });
  it('顧客紐付きが無ければ率は null', () => {
    expect(summarizeRepeatRate([null, undefined], customers, '2026-09-17')).toEqual({ repeaters: 0, newcomers: 0, ratePct: null });
  });
  it('顧客情報が取れないIDは数えない', () => {
    expect(summarizeRepeatRate(['zzz', 'a'], customers, '2026-09-17').ratePct).toBe(100);
  });
});

describe('予算', () => {
  it('月予算を日割り（端数切り捨て）', () => {
    expect(dailyBudgetFromMonthly(3_000_000, '2026-09-17')).toBe(100_000); // 30日
    expect(dailyBudgetFromMonthly(1_000_000, '2026-02-01')).toBe(35_714); // 28日
    expect(dailyBudgetFromMonthly(1_000_000, '2028-02-01')).toBe(34_482); // うるう年29日
    expect(dailyBudgetFromMonthly(0, '2026-09-17')).toBeNull();
    expect(dailyBudgetFromMonthly(null, '2026-09-17')).toBeNull();
  });
  it('達成率（リングは0〜100に丸める）', () => {
    expect(budgetAchievement(175_014, 400_000)).toEqual({ pct: 44, ringPct: 44 });
    expect(budgetAchievement(500_000, 400_000)).toEqual({ pct: 125, ringPct: 100 });
    expect(budgetAchievement(-10, 400_000)).toEqual({ pct: 0, ringPct: 0 });
    expect(budgetAchievement(1000, null)).toEqual({ pct: null, ringPct: 0 });
  });
  it('前日比の表示', () => {
    expect(formatDayDelta(30, 25, '組')).toBe('+5組');
    expect(formatDayDelta(10, 13, '名')).toBe('−3名');
    expect(formatDayDelta(4, 4, '組')).toBe('±0組');
    expect(formatDayDelta(1200, 0, '名')).toBe('+1,200名');
  });
});
