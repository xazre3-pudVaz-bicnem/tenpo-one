import { describe, it, expect } from 'vitest';
import {
  FLOOR_BLOCK,
  TABLE_STEP,
  changedTableOrders,
  compareTableNames,
  renumberTablesByName,
  type SortableTable,
} from '@/lib/table-sort';

const t = (id: string, name: string, floorId: string | null): SortableTable => ({ id, name, floorId });

describe('compareTableNames', () => {
  it('数字を数として比べる（T2 が T10 より前）', () => {
    expect(compareTableNames('T2', 'T10')).toBeLessThan(0);
    expect(compareTableNames('C10', 'C9')).toBeGreaterThan(0);
  });

  it('同じ名前は 0', () => {
    expect(compareTableNames('T301', 'T301')).toBe(0);
  });

  it('並べ替えに使うと人が見て自然な順になる', () => {
    const names = ['T325', 'C8', 'T301', 'C10', 'T318', 'C2', 'T4'];
    expect([...names].sort(compareTableNames)).toEqual(['C2', 'C8', 'C10', 'T4', 'T301', 'T318', 'T325']);
  });
});

describe('renumberTablesByName', () => {
  it('フロア順 → 名前順に振り直す', () => {
    const plan = renumberTablesByName(
      [t('c1', 'C1', 'f4'), t('a', 'T301', 'f3'), t('b', 'T318', 'f3'), t('d', 'T401', 'f4')],
      ['f3', 'f4']
    );
    expect(plan).toEqual([
      { id: 'a', sortOrder: FLOOR_BLOCK + TABLE_STEP },
      { id: 'b', sortOrder: FLOOR_BLOCK + TABLE_STEP * 2 },
      { id: 'c1', sortOrder: FLOOR_BLOCK * 2 + TABLE_STEP },
      { id: 'd', sortOrder: FLOOR_BLOCK * 2 + TABLE_STEP * 2 },
    ]);
  });

  it('あとから足した卓が先に来ていても名前順に直る', () => {
    const plan = renumberTablesByName([t('new', 'T318', 'f3'), t('old', 'T301', 'f3')], ['f3']);
    const byId = new Map(plan.map((p) => [p.id, p.sortOrder]));
    expect(byId.get('old')).toBeLessThan(byId.get('new') as number);
  });

  it('C卓は T卓のあと（名前順どおり）', () => {
    const plan = renumberTablesByName([t('c', 'C1', 'f4'), t('x', 'T410', 'f4')], ['f4']);
    const byId = new Map(plan.map((p) => [p.id, p.sortOrder]));
    expect(byId.get('c')).toBeLessThan(byId.get('x') as number);
  });

  it('フロア未設定・知らないフロアの卓はいちばん後ろのブロック', () => {
    const plan = renumberTablesByName([t('none', '席1', null), t('gone', '席2', 'deleted'), t('ok', 'T301', 'f3')], ['f3']);
    const byId = new Map(plan.map((p) => [p.id, p.sortOrder]));
    expect(byId.get('ok')).toBe(FLOOR_BLOCK + TABLE_STEP);
    expect(byId.get('none')).toBe(FLOOR_BLOCK * 2 + TABLE_STEP);
    expect(byId.get('gone')).toBe(FLOOR_BLOCK * 2 + TABLE_STEP * 2);
  });

  it('卓が多いフロアでも次のフロアに食い込まない', () => {
    const many = Array.from({ length: 150 }, (_, i) => t(`id${i}`, `T${String(i + 1).padStart(3, '0')}`, 'f3'));
    const plan = renumberTablesByName([...many, t('next', 'T401', 'f4')], ['f3', 'f4']);
    const byId = new Map(plan.map((p) => [p.id, p.sortOrder]));
    const maxOnF3 = Math.max(...many.map((m) => byId.get(m.id) as number));
    expect(maxOnF3).toBeLessThan(FLOOR_BLOCK * 2);
    expect(byId.get('next')).toBe(FLOOR_BLOCK * 2 + TABLE_STEP);
  });

  it('全卓分を返す（数が減らない）', () => {
    const rows = [t('a', 'T301', 'f3'), t('b', 'T302', 'f3'), t('c', 'C1', 'f4')];
    expect(renumberTablesByName(rows, ['f3', 'f4'])).toHaveLength(3);
  });

  it('卓が無ければ空', () => {
    expect(renumberTablesByName([], ['f3'])).toEqual([]);
  });
});

describe('changedTableOrders', () => {
  it('変わる卓だけ返す', () => {
    const plan = [
      { id: 'a', sortOrder: 1010 },
      { id: 'b', sortOrder: 1020 },
    ];
    const changed = changedTableOrders(plan, new Map([['a', 1010], ['b', 55]]));
    expect(changed).toEqual([{ id: 'b', sortOrder: 1020 }]);
  });

  it('今の値が未設定なら書き換え対象', () => {
    const changed = changedTableOrders([{ id: 'a', sortOrder: 1010 }], new Map([['a', null]]));
    expect(changed).toHaveLength(1);
  });
});
