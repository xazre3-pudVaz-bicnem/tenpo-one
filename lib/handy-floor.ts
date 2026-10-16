/**
 * ハンディのテーブル一覧のフロア切り替え（3F・4F・5F）。
 *
 * 2026-10-16 SHUNKA 新宿の要望「ハンディでもフロアを選べるように」。
 * 卓が 48 あるとスマホの一覧が長すぎて、担当のフロアの卓を探すのに時間がかかるため。
 * 最初に出すフロアはレジ（オーダー・会計）と同じ store_settings.settings.floorBoard.defaultFloorId。
 * 端末で選び直したフロアは、その端末に覚えさせる（localStorage）。ここは純粋な関数だけ（テスト対象）。
 */
import { initialFloorFilter } from './floor-nav';

/** すべてのフロア */
export const HANDY_FLOOR_ALL = 'all';
/** フロアを決めていない卓 */
export const HANDY_FLOOR_NONE = '_none';

export interface HandyFloorOption {
  id: string;
  name: string;
}

export interface HandyFloorTab {
  id: string;
  label: string;
}

/**
 * タブに出すフロア。選ぶものが1つしかない店（フロア1つだけ・フロア無し）ではタブを出さない
 * （今までと同じ見た目のまま）。
 */
export function handyFloorTabs(
  floors: readonly HandyFloorOption[],
  hasUnassigned: boolean
): HandyFloorTab[] {
  const real = floors.filter((f) => f.id && f.name.trim() !== '');
  if (real.length + (hasUnassigned ? 1 : 0) < 2) return [];
  return [
    { id: HANDY_FLOOR_ALL, label: 'ALL' },
    ...real.map((f) => ({ id: f.id, label: f.name })),
    ...(hasUnassigned ? [{ id: HANDY_FLOOR_NONE, label: '未分類' }] : []),
  ];
}

/**
 * 画面を開いたときのフロア。
 * 1. その端末で前に選んだフロア（まだある場合）
 * 2. 店舗の「レジで最初に出すフロア」
 * 3. ALL
 */
export function initialHandyFloor(
  tabIds: readonly string[],
  defaultFloorId: string | null,
  remembered?: string | null
): string {
  if (remembered && tabIds.includes(remembered)) return remembered;
  const fromStore = initialFloorFilter(tabIds, defaultFloorId);
  return tabIds.includes(fromStore) ? fromStore : HANDY_FLOOR_ALL;
}

/** 選んだフロアの卓だけにする */
export function filterHandyTables<T extends { floorId: string | null }>(
  tables: readonly T[],
  filter: string
): T[] {
  if (filter === HANDY_FLOOR_ALL) return [...tables];
  if (filter === HANDY_FLOOR_NONE) return tables.filter((t) => !t.floorId);
  return tables.filter((t) => t.floorId === filter);
}

/** 端末に覚えさせるときのキー（店舗ごと） */
export function handyFloorStorageKey(storeId: string): string {
  return `tenpo-handy-floor:${storeId}`;
}
