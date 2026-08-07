import { describe, expect, it } from 'vitest';
import { groupDaysByRule, pickRuleForDate, type PayrollRuleCandidate } from '@/app/app/payroll/rule-periods';

function hourlyRule(overrides: Partial<PayrollRuleCandidate> & { id: string; baseAmount: number; effectiveFrom: string }): PayrollRuleCandidate {
  return {
    profileId: 'p1',
    storeId: null,
    effectiveTo: null,
    payType: 'hourly',
    overtimeRate: 1.25,
    nightRate: 0.25,
    holidayRate: 1.35,
    commuteAllowance: 0,
    allowances: [],
    ...overrides,
  };
}

describe('pickRuleForDate（適用期間の日単位解決）', () => {
  const raise = hourlyRule({ id: 'before', baseAmount: 1300, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-14' });
  const after = hourlyRule({ id: 'after', baseAmount: 1350, effectiveFrom: '2026-08-15', effectiveTo: null });

  it('期間内の日には対応するルールが選ばれる', () => {
    expect(pickRuleForDate([raise, after], 'p1', null, '2026-08-01')?.id).toBe('before');
    expect(pickRuleForDate([raise, after], 'p1', null, '2026-08-14')?.id).toBe('before');
    expect(pickRuleForDate([raise, after], 'p1', null, '2026-08-15')?.id).toBe('after');
    expect(pickRuleForDate([raise, after], 'p1', null, '2026-08-31')?.id).toBe('after');
  });

  it('どのルールの期間にも含まれない日は null', () => {
    const onlyAugust = hourlyRule({ id: 'aug', baseAmount: 1300, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' });
    expect(pickRuleForDate([onlyAugust], 'p1', null, '2026-09-01')).toBeNull();
  });

  it('店舗別ルールが全店共通ルールより優先される', () => {
    const common = hourlyRule({ id: 'common', baseAmount: 1300, effectiveFrom: '2026-08-01', storeId: null });
    const storeSpecific = hourlyRule({ id: 'store-a', baseAmount: 1400, effectiveFrom: '2026-08-01', storeId: 'store-a' });
    expect(pickRuleForDate([common, storeSpecific], 'p1', 'store-a', '2026-08-10')?.id).toBe('store-a');
    expect(pickRuleForDate([common, storeSpecific], 'p1', 'store-b', '2026-08-10')?.id).toBe('common');
  });

  it('同順位内では effective_from が新しい方を優先する', () => {
    const older = hourlyRule({ id: 'older', baseAmount: 1200, effectiveFrom: '2026-01-01' });
    const newer = hourlyRule({ id: 'newer', baseAmount: 1300, effectiveFrom: '2026-06-01' });
    expect(pickRuleForDate([older, newer], 'p1', null, '2026-08-01')?.id).toBe('newer');
  });

  it('別スタッフのルールは対象外', () => {
    const other = hourlyRule({ id: 'other', baseAmount: 1300, effectiveFrom: '2026-08-01', profileId: 'p2' });
    expect(pickRuleForDate([other], 'p1', null, '2026-08-10')).toBeNull();
  });
});

describe('groupDaysByRule（期間跨ぎ昇給の日別グループ化）', () => {
  const before = hourlyRule({ id: 'before', baseAmount: 1300, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-14' });
  const after = hourlyRule({ id: 'after', baseAmount: 1350, effectiveFrom: '2026-08-15', effectiveTo: null });

  it('8/1〜8/14 と 8/15〜8/31 で2区間に分かれ、区間ごとに正しい勤務日が入る', () => {
    const days = [
      { workDate: '2026-08-01' },
      { workDate: '2026-08-10' },
      { workDate: '2026-08-14' },
      { workDate: '2026-08-15' },
      { workDate: '2026-08-20' },
      { workDate: '2026-08-31' },
    ];
    const { groups, skippedDates } = groupDaysByRule(days, [before, after], 'p1', null);

    expect(skippedDates).toEqual([]);
    expect(groups).toHaveLength(2);

    expect(groups[0].rule.id).toBe('before');
    expect(groups[0].rangeStart).toBe('2026-08-01');
    expect(groups[0].rangeEnd).toBe('2026-08-14');
    expect(groups[0].days.map((d) => d.workDate)).toEqual(['2026-08-01', '2026-08-10', '2026-08-14']);

    expect(groups[1].rule.id).toBe('after');
    expect(groups[1].rangeStart).toBe('2026-08-15');
    expect(groups[1].rangeEnd).toBe('2026-08-31');
    expect(groups[1].days.map((d) => d.workDate)).toEqual(['2026-08-15', '2026-08-20', '2026-08-31']);
  });

  it('グループは effective_from の昇順（期間の早い順）で返る', () => {
    const days = [{ workDate: '2026-08-20' }, { workDate: '2026-08-05' }];
    const { groups } = groupDaysByRule(days, [after, before], 'p1', null);
    expect(groups.map((g) => g.rule.id)).toEqual(['before', 'after']);
  });

  it('適用ルールのない日は skippedDates に集約され、集計対象から除外される', () => {
    const onlyAugust = hourlyRule({ id: 'aug', baseAmount: 1300, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' });
    const days = [{ workDate: '2026-08-15' }, { workDate: '2026-09-01' }];
    const { groups, skippedDates } = groupDaysByRule(days, [onlyAugust], 'p1', null);

    expect(groups).toHaveLength(1);
    expect(groups[0].days.map((d) => d.workDate)).toEqual(['2026-08-15']);
    expect(skippedDates).toEqual(['2026-09-01']);
  });

  it('ルールが1件も無いスタッフは groups が空になる', () => {
    const { groups, skippedDates } = groupDaysByRule([{ workDate: '2026-08-01' }], [], 'p1', null);
    expect(groups).toEqual([]);
    expect(skippedDates).toEqual(['2026-08-01']);
  });
});
