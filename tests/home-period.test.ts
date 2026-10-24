import { describe, expect, it } from 'vitest';
import {
  achievementPct,
  budgetForRange,
  compareRange,
  delta,
  parseHomeCompare,
  parseHomeRange,
  rangeLabel,
  resolveHomeRange,
  sameDayPrevMonth,
} from '@/lib/home-period';

describe('home-period: 期間タブ', () => {
  const today = '2026-10-24';

  it('本日・昨日・過去7日間・今月', () => {
    expect(resolveHomeRange('today', today)).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(resolveHomeRange('yesterday', today)).toEqual({ from: '2026-10-23', to: '2026-10-23' });
    expect(resolveHomeRange('7d', today)).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(resolveHomeRange('month', today)).toEqual({ from: '2026-10-01', to: '2026-10-24' });
  });

  it('期間指定：from/to を使う。壊れていれば今月、逆なら入れ替え、片方だけならその日', () => {
    expect(resolveHomeRange('custom', today, { from: '2026-10-01', to: '2026-10-10' })).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(resolveHomeRange('custom', today, { from: '2026-10-10', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(resolveHomeRange('custom', today, { from: 'abc' })).toEqual({ from: '2026-10-01', to: '2026-10-24' });
    expect(resolveHomeRange('custom', today, { to: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-05' });
  });

  it('期間指定は 365 日まで', () => {
    expect(resolveHomeRange('custom', today, { from: '2024-01-01', to: '2026-10-24' })).toEqual({ from: '2025-10-24', to: '2026-10-24' });
  });

  it('タブ・比較の読み取り（知らない値は既定）', () => {
    expect(parseHomeRange('7d')).toBe('7d');
    expect(parseHomeRange(['month'])).toBe('month');
    expect(parseHomeRange('x')).toBe('today');
    expect(parseHomeRange(undefined)).toBe('today');
    expect(parseHomeCompare('day')).toBe('day');
    expect(parseHomeCompare(undefined)).toBe('week');
  });
});

describe('home-period: 比較の期間', () => {
  it('前日比は同じ長さの直前', () => {
    expect(compareRange({ from: '2026-10-24', to: '2026-10-24' }, 'day')).toEqual({ from: '2026-10-23', to: '2026-10-23' });
    expect(compareRange({ from: '2026-10-18', to: '2026-10-24' }, 'day')).toEqual({ from: '2026-10-11', to: '2026-10-17' });
  });
  it('前週同曜日比は 7 日前', () => {
    expect(compareRange({ from: '2026-10-01', to: '2026-10-24' }, 'week')).toEqual({ from: '2026-09-24', to: '2026-10-17' });
  });
  it('前月同日比は 1 か月前の同じ日（末日に寄せる）', () => {
    expect(sameDayPrevMonth('2026-10-24')).toBe('2026-09-24');
    expect(sameDayPrevMonth('2026-10-31')).toBe('2026-09-30');
    expect(sameDayPrevMonth('2026-03-30')).toBe('2026-02-28');
    expect(sameDayPrevMonth('2026-01-15')).toBe('2025-12-15');
    expect(compareRange({ from: '2026-10-01', to: '2026-10-24' }, 'month')).toEqual({ from: '2026-09-01', to: '2026-09-24' });
  });
  it('見出し', () => {
    expect(rangeLabel({ from: '2026-10-24', to: '2026-10-24' })).toBe('10/24');
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-24' })).toBe('10/1〜10/24');
  });
});

describe('home-period: 増減と予算', () => {
  it('増減率は小数1桁、前が 0 なら null', () => {
    expect(delta(1100, 1000)).toEqual({ pct: 10, diff: 100, direction: 'up' });
    expect(delta(950, 1000)).toEqual({ pct: -5, diff: -50, direction: 'down' });
    expect(delta(1000, 1000)).toEqual({ pct: 0, diff: 0, direction: 'flat' });
    expect(delta(1234, 1000).pct).toBe(23.4);
    expect(delta(500, 0)).toEqual({ pct: null, diff: 500, direction: 'up' });
    expect(delta(0, 0)).toEqual({ pct: null, diff: 0, direction: 'flat' });
  });

  it('期間の予算：日別予算があればそれ、無ければ月予算÷日数。どこにも無ければ null', () => {
    const settings = new Map<string, unknown>([
      ['a', { dailyBudgets: { '2026-10': { '2026-10-24': 50_000 } } }],
      ['b', {}],
    ]);
    const monthly = new Map<string, number>([['b|2026-10', 310_000]]); // 10月は31日 → 1日 10,000
    expect(budgetForRange({ range: { from: '2026-10-24', to: '2026-10-24' }, storeIds: ['a', 'b'], settingsByStore: settings, monthlyByStoreMonth: monthly })).toBe(60_000);
    expect(budgetForRange({ range: { from: '2026-10-23', to: '2026-10-24' }, storeIds: ['a', 'b'], settingsByStore: settings, monthlyByStoreMonth: monthly })).toBe(70_000);
    expect(budgetForRange({ range: { from: '2026-10-24', to: '2026-10-24' }, storeIds: ['c'], settingsByStore: settings, monthlyByStoreMonth: monthly })).toBeNull();
  });

  it('達成率', () => {
    expect(achievementPct(55_000, 50_000)).toBe(110);
    expect(achievementPct(0, 50_000)).toBe(0);
    expect(achievementPct(1000, null)).toBeNull();
  });
});
