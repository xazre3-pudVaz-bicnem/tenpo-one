/**
 * テーブルの並び順（sort_order）を、人が見て自然な順に振り直すための計算。
 *
 * 2026-10-16 SHUNKA 新宿本店：あとから足した卓（C1〜C8・T318〜T325・T509〜T515）が
 * 一覧のいちばん後ろに出てしまい「table number 順番 ma xaina」となった。
 * 卓を足すたびに1卓ずつ直すのは大変なので、フロア順 → 名前の自然順（T2 < T10）で
 * まとめて振り直せるようにする。計算だけをここに置き、保存は
 * app/app/settings/tables/actions.ts の reorderTablesByName が行う。
 */

/** フロアごとの番号の幅（3F→1000番台、4F→2000番台…） */
export const FLOOR_BLOCK = 1000;
/** 同じフロアの中の刻み。あとから1卓だけ手で差し込めるように間を空ける */
export const TABLE_STEP = 10;
/** 刻みを詰めずに入る上限（1000 ÷ 10 − 1） */
const MAX_SPACED = 99;

/**
 * テーブル名を人が見て自然な順で比べる。
 * 数字は数として見るので T2 < T10、C1 < C2 < C10 になる。
 */
export function compareTableNames(a: string, b: string): number {
  const byName = a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' });
  if (byName !== 0) return byName;
  // 大文字小文字だけ違う名前でも順番がぶれないようにする
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface SortableTable {
  id: string;
  name: string;
  floorId: string | null;
}

export interface TableSortOrder {
  id: string;
  sortOrder: number;
}

/**
 * フロア順 → 名前の自然順で sort_order を振り直す。
 *
 * @param tables  振り直す卓（active のみを渡す）
 * @param floorOrder フロアIDを画面の並び順に並べたもの
 * @returns 全卓分の {id, sortOrder}（変更がない卓も含む）
 *
 * フロアが未設定の卓・無くなったフロアの卓は、いちばん後ろのブロックにまとめる。
 */
export function renumberTablesByName(tables: SortableTable[], floorOrder: string[]): TableSortOrder[] {
  const blockOf = new Map<string, number>();
  floorOrder.forEach((id, i) => blockOf.set(id, i + 1));
  const unassignedBlock = floorOrder.length + 1;

  const groups = new Map<number, SortableTable[]>();
  for (const t of tables) {
    const block = (t.floorId && blockOf.get(t.floorId)) || unassignedBlock;
    const list = groups.get(block);
    if (list) list.push(t);
    else groups.set(block, [t]);
  }

  const out: TableSortOrder[] = [];
  for (const [block, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const step = list.length > MAX_SPACED ? 1 : TABLE_STEP;
    const base = block * FLOOR_BLOCK;
    [...list]
      .sort((a, b) => compareTableNames(a.name, b.name))
      .forEach((t, i) => out.push({ id: t.id, sortOrder: base + (i + 1) * step }));
  }
  return out;
}

/** 今の並び順と比べて、実際に書き換えが要る卓だけを返す */
export function changedTableOrders(
  plan: TableSortOrder[],
  current: Map<string, number | null>
): TableSortOrder[] {
  return plan.filter((p) => current.get(p.id) !== p.sortOrder);
}
