/**
 * レシートプリンターの「担当フロア」。
 *
 * 2026-09-22 SHUNKA 新宿の要望: 3フロアの店（4F=受付・会計・管理、3F・5F=客席＋会計伝票を出す場所）。
 * 3F の卓の会計伝票（中間伝票・QR注文のお会計伝票）は 3F のプリンター、5F の卓は 5F のプリンターから出したい。
 *
 * ルール（DB: printer_configs.floor_ids。空＝担当フロアなし＝店の既定プリンター）:
 *   - 担当フロアがあるプリンター … そのフロアの卓の伝票だけ出す
 *   - 担当フロアが無いプリンター（既定） … どのプリンターも担当していないフロアの卓、フロア未割当の卓、卓なしの伝票
 *   - レシート（会計確定）・ドロアは今まで通り既定プリンター（会計はレジのある階でするため）
 * 担当フロアを1台も設定していない店は、これまでと全く同じ動き（全部既定プリンター）。
 * ここは純粋な関数だけ（DB 非依存・テスト対象）。
 */

export interface FloorPrinter {
  id: string;
  /** 担当フロア（floors.id）。空なら既定プリンター */
  floorIds: readonly string[];
}

/** 担当フロアが無い＝店の既定プリンターか */
export function isDefaultFloorPrinter(p: FloorPrinter): boolean {
  return p.floorIds.length === 0;
}

/** どれかのプリンターが担当しているフロアか */
function floorIsAssigned(floorId: string, printers: readonly FloorPrinter[]): boolean {
  return printers.some((p) => p.floorIds.includes(floorId));
}

/**
 * このプリンターが、このフロアの卓の伝票を出す担当か。
 * printers には同じ店・同じ用途（自動印刷ONのレシート機など）の比較対象を全部渡す（自分を含んでよい）。
 */
export function printerServesFloor(
  printer: FloorPrinter,
  floorId: string | null | undefined,
  printers: readonly FloorPrinter[]
): boolean {
  if (!isDefaultFloorPrinter(printer)) return !!floorId && printer.floorIds.includes(floorId);
  if (!floorId) return true;
  return !floorIsAssigned(floorId, printers);
}

/** 店の既定プリンター（担当フロアの無いもの。無ければ先頭）。並び順は呼び出し側で決めておく */
export function pickDefaultPrinter<T extends FloorPrinter>(printers: readonly T[]): T | null {
  return printers.find(isDefaultFloorPrinter) ?? printers[0] ?? null;
}

/** このフロアの卓の伝票を出すプリンター（担当 → 既定 → 先頭） */
export function pickPrinterForFloor<T extends FloorPrinter>(
  printers: readonly T[],
  floorId: string | null | undefined
): T | null {
  if (floorId) {
    const own = printers.find((p) => p.floorIds.includes(floorId));
    if (own) return own;
  }
  return pickDefaultPrinter(printers);
}

/** DB の値（null・重複・不正値あり）を担当フロアの配列に整える */
export function normalizeFloorIds(value: unknown, allowed?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !v) continue;
    if (allowed && !allowed.has(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * 会計伝票（中間伝票・QRのお会計伝票）を出せるプリンターか。
 * レシート機は常に出せる。厨房（ドリンク）機は「会計伝票も出す」（bill_slips）のときだけ
 * （SHUNKA 新宿: 3F・5F はドリンク・バー機1台でドリンク伝票と会計伝票の両方を出す）。
 */
export function printsBillSlips(printer: { usage: string; bill_slips?: boolean | null }): boolean {
  return printer.usage === 'receipt' || (printer.usage === 'kitchen' && !!printer.bill_slips);
}
