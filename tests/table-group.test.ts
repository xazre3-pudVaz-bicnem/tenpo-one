import { describe, expect, it } from 'vitest';
import { groupOfTable, setTableGroup, tableGroupsFrom } from '@/lib/table-group';

describe('tableGroupsFrom', () => {
  it('壊れた値は捨て、2卓以上のグループだけ返す', () => {
    expect(tableGroupsFrom(null)).toEqual([]);
    expect(
      tableGroupsFrom({
        tableGroups: [
          { id: 'g1', tableIds: ['a', 'b'] },
          { id: 'g2', tableIds: ['c'] },
          { id: 3, tableIds: ['d', 'e'] },
          { tableIds: ['f', 'g'] },
        ],
      })
    ).toEqual([{ id: 'g1', tableIds: ['a', 'b'] }]);
  });

  it('同じ卓は1度だけ入る', () => {
    expect(tableGroupsFrom({ tableGroups: [{ id: 'g', tableIds: ['a', 'a', 'b'] }] })).toEqual([
      { id: 'g', tableIds: ['a', 'b'] },
    ]);
  });
});

describe('groupOfTable', () => {
  it('入っているグループを返す', () => {
    const groups = [{ id: 'g1', tableIds: ['a', 'b'] }];
    expect(groupOfTable(groups, 'b')?.id).toBe('g1');
    expect(groupOfTable(groups, 'z')).toBeNull();
  });
});

describe('setTableGroup', () => {
  it('選んだ卓は前のグループから外れて新しいグループになる', () => {
    const groups = [
      { id: 'g1', tableIds: ['a', 'b', 'c'] },
      { id: 'g2', tableIds: ['d', 'e'] },
    ];
    expect(setTableGroup(groups, ['a', 'd'], 'g3')).toEqual([
      { id: 'g1', tableIds: ['b', 'c'] },
      { id: 'g3', tableIds: ['a', 'd'] },
    ]);
  });

  it('1卓だけならグループを解除する', () => {
    const groups = [{ id: 'g1', tableIds: ['a', 'b'] }];
    expect(setTableGroup(groups, ['a'], 'g2')).toEqual([]);
  });
});
