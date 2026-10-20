/**
 * 別々会計で「1つの品を何人かで食べた」ときに分ける計算（2026-10-20 高田馬場「同じ品を3人で食べると別々会計できない」）。
 * サーバー（app/app/pos/actions.ts divideOrderItem・splitOrder）と画面の両方で使う。
 */

/** 分けられる人数 */
export const DIVIDE_MIN = 2;
export const DIVIDE_MAX = 10;

/**
 * 1つの品の金額を n 人で分ける。合計は必ず元の金額と同じ（端数は前の人から1円ずつ）。
 * 例：3,000円を3人 → [1000, 1000, 1000]／1,000円を3人 → [334, 333, 333]
 */
export function shareAmounts(price: number, parts: number): number[] {
  if (!Number.isInteger(price) || price < 0) throw new Error('金額が不正です');
  if (!Number.isInteger(parts) || parts < DIVIDE_MIN || parts > DIVIDE_MAX) {
    throw new Error(`${DIVIDE_MIN}〜${DIVIDE_MAX}人で分けてください`);
  }
  const base = Math.floor(price / parts);
  const extra = price - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 分けた品の名前：「盛り合わせ（1/3）」 */
export function sharedName(name: string, parts: number): string {
  return `${name}（1/${parts}）`;
}

/**
 * 伝票分割で品の数量の一部を別の伝票へ移すときの「厨房へ伝えた数量（kitchen_printed_qty）」の振り分け。
 * 合計は変えない（厨房の伝票は「伝えた数」と「今の数」の差だけ出すので、合計が変わると取消・追加の伝票が出てしまう）。
 * 移す分を先に「伝えた」にする（会計のときはふつう全部伝えてある）。
 */
export function splitPrintedQty(printed: number, moved: number): { stay: number; moved: number } {
  const p = Math.max(0, printed);
  const m = Math.min(moved, p);
  return { stay: p - m, moved: m };
}
