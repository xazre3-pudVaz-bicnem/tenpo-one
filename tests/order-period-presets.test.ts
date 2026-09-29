import { describe, it, expect } from 'vitest';
import { orderPeriodPresets, weekStart } from '@/lib/order-period-presets';

describe('伝票明細の期間ボタン（今日・昨日・一昨日・今週・今月）', () => {
  it('2026-09-29（火）', () => {
    const p = Object.fromEntries(orderPeriodPresets('2026-09-29').map((x) => [x.label, [x.from, x.to]]));
    expect(p['今日']).toEqual(['2026-09-29', '2026-09-29']);
    expect(p['昨日']).toEqual(['2026-09-28', '2026-09-28']);
    expect(p['一昨日']).toEqual(['2026-09-27', '2026-09-27']);
    expect(p['今週']).toEqual(['2026-09-28', '2026-09-29']);
    expect(p['今月']).toEqual(['2026-09-01', '2026-09-29']);
    expect(p['過去7日']).toEqual(['2026-09-23', '2026-09-29']);
  });
  it('今週は月曜はじまり（日曜は前の月曜から）・月をまたぐ', () => {
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
    const p = Object.fromEntries(orderPeriodPresets('2026-10-01').map((x) => [x.label, [x.from, x.to]]));
    expect(p['一昨日']).toEqual(['2026-09-29', '2026-09-29']);
    expect(p['今月']).toEqual(['2026-10-01', '2026-10-01']);
  });
});
