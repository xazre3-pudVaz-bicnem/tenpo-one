import { describe, it, expect } from 'vitest';
import {
  filterHandyTables,
  handyFloorStorageKey,
  handyFloorTabs,
  initialHandyFloor,
  HANDY_FLOOR_ALL,
  HANDY_FLOOR_NONE,
} from '@/lib/handy-floor';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F3 = { id: id(3), name: '3F' };
const F4 = { id: id(4), name: '4F' };
const F5 = { id: id(5), name: '5F' };

describe('ハンディのフロア切り替え（2026-10-16 SHUNKA 新宿「ハンディでもフロアを選べるように」）', () => {
  it('フロアが2つ以上あるときだけタブを出す', () => {
    expect(handyFloorTabs([F3, F4, F5], false).map((t) => t.label)).toEqual(['ALL', '3F', '4F', '5F']);
    // フロア1つだけ・未分類なし → タブは出さない（今までと同じ画面）
    expect(handyFloorTabs([F4], false)).toEqual([]);
    expect(handyFloorTabs([], false)).toEqual([]);
    // フロア1つ＋未分類の卓があるときは選べるようにする
    expect(handyFloorTabs([F4], true).map((t) => t.label)).toEqual(['ALL', '4F', '未分類']);
    // 名前の無いフロアは出さない
    expect(handyFloorTabs([F4, { id: id(9), name: '  ' }], false)).toEqual([]);
  });

  it('開いたときのフロア：端末で選んだフロア → 店舗の「最初に出すフロア」→ ALL', () => {
    const tabs = handyFloorTabs([F3, F4, F5], false).map((t) => t.id);
    expect(initialHandyFloor(tabs, F4.id)).toBe(F4.id);
    expect(initialHandyFloor(tabs, F4.id, F5.id)).toBe(F5.id);
    expect(initialHandyFloor(tabs, null)).toBe(HANDY_FLOOR_ALL);
    // 無くなったフロアを覚えていても ALL に戻す（壊れた値も同じ）
    expect(initialHandyFloor(tabs, null, id(99))).toBe(HANDY_FLOOR_ALL);
    expect(initialHandyFloor(tabs, id(99))).toBe(HANDY_FLOOR_ALL);
    expect(initialHandyFloor([], F4.id)).toBe(HANDY_FLOOR_ALL);
  });

  it('選んだフロアの卓だけにする（未分類・ALL も）', () => {
    const tables = [
      { id: 't1', floorId: F3.id },
      { id: 't2', floorId: F4.id },
      { id: 't3', floorId: F4.id },
      { id: 't4', floorId: null },
    ];
    expect(filterHandyTables(tables, HANDY_FLOOR_ALL).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(filterHandyTables(tables, F4.id).map((t) => t.id)).toEqual(['t2', 't3']);
    expect(filterHandyTables(tables, HANDY_FLOOR_NONE).map((t) => t.id)).toEqual(['t4']);
    // 並び順は元のまま（sort_order で並べたものを崩さない）
    expect(filterHandyTables(tables, HANDY_FLOOR_ALL)).not.toBe(tables);
  });

  it('覚えるキーは店舗ごと', () => {
    expect(handyFloorStorageKey(id(1))).toBe(`tenpo-handy-floor:${id(1)}`);
    expect(handyFloorStorageKey(id(1))).not.toBe(handyFloorStorageKey(id(2)));
  });
});
