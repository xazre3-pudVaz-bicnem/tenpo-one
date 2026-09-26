import { describe, expect, it } from 'vitest';
import { groupOfTable, setTableGroup, tableGroupsFrom, groupOrderTable } from '@/lib/table-group';

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

describe('グループの伝票を持つ卓（QR の振り向け先）', () => {
  const g = { id: 'g1', tableIds: ['A', 'B', 'C'] };

  it('グループに入っていない卓は振り向けない', () => {
    expect(groupOrderTable(null, 'A', [{ tableId: 'A', openedAtMs: 1 }])).toBeNull();
    expect(groupOrderTable(g, 'Z', [{ tableId: 'A', openedAtMs: 1 }])).toBeNull();
  });

  it('誰も伝票を持っていなければ振り向けない（自分の卓で新規に立つ）', () => {
    expect(groupOrderTable(g, 'B', [])).toBeNull();
    expect(groupOrderTable(g, 'B', [{ tableId: 'Z', openedAtMs: 1 }])).toBeNull();
  });

  it('自分の卓に伝票があればそのまま', () => {
    expect(groupOrderTable(g, 'B', [{ tableId: 'B', openedAtMs: 1 }, { tableId: 'A', openedAtMs: 2 }])).toBeNull();
  });

  it('伝票を持つ別の卓があればそこへ振り向ける', () => {
    expect(groupOrderTable(g, 'B', [{ tableId: 'A', openedAtMs: 1 }])).toBe('A');
  });

  it('複数あれば新しい伝票の卓', () => {
    expect(
      groupOrderTable(g, 'B', [
        { tableId: 'A', openedAtMs: 1 },
        { tableId: 'C', openedAtMs: 5 },
      ])
    ).toBe('C');
  });
});
