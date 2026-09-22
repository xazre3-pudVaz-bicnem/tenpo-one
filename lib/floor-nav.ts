/**
 * レジ（オーダー・会計）のフロア画面の「最初に出すフロア」とスワイプ移動。
 *
 * 2026-09-22 SHUNKA 新宿の要望（3F・4F・5F の3フロア。受付・会計は 4F）:
 *   - 画面を開いたら 4F が最初に出る
 *   - 右にスライドすると 5F、左にスライドすると 3F（フロアの並び順で1つずつ隣へ）
 * 最初に出すフロアは store_settings.settings.floorBoard.defaultFloorId（DB 変更なし）。
 * 決めていない店は今まで通り「すべて」から始まる。ここは純粋な関数だけ（テスト対象）。
 */

export interface FloorBoardSettings {
  /** 最初に出すフロア（floors.id）。null なら「すべて」 */
  defaultFloorId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** store_settings.settings から読む（壊れた値は捨てる） */
export function floorBoardFrom(settings: unknown): FloorBoardSettings {
  const root = isRecord(settings) ? settings.floorBoard : null;
  const id = isRecord(root) ? root.defaultFloorId : null;
  return { defaultFloorId: typeof id === 'string' && UUID.test(id) ? id : null };
}

export function floorBoardToJson(s: FloorBoardSettings): Record<string, unknown> {
  return { defaultFloorId: s.defaultFloorId };
}

/** 画面を開いたときの絞り込み。最初のフロアが今もあればそのフロア、無ければ「すべて」 */
export function initialFloorFilter(floorIds: readonly string[], defaultFloorId: string | null): string {
  return defaultFloorId && floorIds.includes(defaultFloorId) ? defaultFloorId : 'all';
}

export type SwipeDir = 'left' | 'right';

/**
 * 指の動き（px）からスワイプの向きを決める。横に threshold 以上動き、縦より横が大きいときだけ
 * （縦スクロールをスワイプと取り違えない）。
 */
export function swipeDirection(dx: number, dy: number, threshold = 60): SwipeDir | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 1.2) return null;
  return dx > 0 ? 'right' : 'left';
}

/**
 * スワイプで隣のフロアへ。floorIds はフロアの並び順（3F, 4F, 5F）。
 * 右スライド → 次のフロア（4F → 5F）、左スライド → 前のフロア（4F → 3F）。端では止まる。
 * 「すべて」「未分類」から動かしたときは、最初に出すフロア（無ければ先頭）へ。
 */
export function stepFloor(
  floorIds: readonly string[],
  current: string,
  dir: SwipeDir,
  defaultFloorId: string | null = null
): string {
  if (floorIds.length === 0) return current;
  const idx = floorIds.indexOf(current);
  if (idx < 0) return initialFloorFilter(floorIds, defaultFloorId) === 'all' ? floorIds[0] : (defaultFloorId as string);
  const next = dir === 'right' ? idx + 1 : idx - 1;
  if (next < 0 || next >= floorIds.length) return current;
  return floorIds[next];
}
