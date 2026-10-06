import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupOfTable, removeGroupOfTable, setTableGroup, tableGroupsFrom, groupOrderTable } from '@/lib/table-group';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

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

describe('removeGroupOfTable（解除・会計完了・テーブルクリア）', () => {
  const groups = [
    { id: 'g1', tableIds: ['a', 'b', 'c'] },
    { id: 'g2', tableIds: ['d', 'e'] },
  ];

  it('その卓が入っているグループをまるごと消す（3卓のグループでも残りを残さない）', () => {
    expect(removeGroupOfTable(groups, 'b')).toEqual([{ id: 'g2', tableIds: ['d', 'e'] }]);
    expect(removeGroupOfTable(groups, 'e')).toEqual([{ id: 'g1', tableIds: ['a', 'b', 'c'] }]);
  });

  it('入っていない卓なら何も変わらない', () => {
    expect(removeGroupOfTable(groups, 'z')).toEqual(groups);
    expect(removeGroupOfTable([], 'a')).toEqual([]);
  });
});

describe('テーブル連携は会計完了・テーブルクリアで自動解除、卓の箱に連携の印（2026-10-06 Ronnie 高田馬場）', () => {
  it('会計（checkout）とテーブルクリアで dissolveTableGroupOf を呼ぶ', () => {
    const src = read('app/app/pos/actions.ts');
    expect(src).toContain("import { dissolveTableGroupOf } from '@/lib/table-group-server'");
    expect(src.split('dissolveTableGroupOf(order.store_id, order.table_id, ctx.userId)').length - 1).toBe(2);
  });

  it('「解除」は自分の卓を1つ渡す（空の配列は何もしない。前は解除が効いていなかった）', () => {
    expect(read('components/floor/table-sheet.tsx')).toContain('saveTableGroupAction([table.id])');
    expect(read('components/floor/table-sheet.tsx')).not.toContain('saveTableGroupAction([])');
    const action = read('app/app/floor/group-actions.ts');
    expect(action).toContain('if (ids.length === 0) return {};');
    expect(action).toContain('ids.length === 1 ? removeGroupOfTable(groups, ids[0])');
  });

  it('卓の箱に「連携 T1+T3」の印', () => {
    const card = read('components/floor/table-card.tsx');
    expect(card).toContain("連携 {linked.join('+')}");
    expect(card).toContain('<Link2');
    expect(read('app/app/floor/page.tsx')).toContain('groupTableNames:');
  });
});
