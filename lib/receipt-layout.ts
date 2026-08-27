/**
 * レシート整形の共通ロジック（純関数・テスト対象）。
 * Star Document Markup / StarPRNT の両レンダラが同じ桁揃えを共有するためにここへ集約する。
 */

/** 感熱ロール幅ごとの1行あたり半角文字数（font A・mC-Print3目安）。全角は2文字ぶんで数える。 */
export const COLS: Record<number, number> = { 58: 32, 80: 48 };

export type PaperWidth = 58 | 80;

/** 用紙幅から桁数を得る（未知の幅は80mm相当にフォールバック）。 */
export function colsFor(paperWidth?: PaperWidth): number {
  return COLS[paperWidth ?? 80] ?? 48;
}

export const yen = (n: number): string => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 表示幅（CJK全角=2, その他=1）。二段組の桁揃えに使う。 */
export function dispWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // CJK統合漢字/かな/全角記号/全角英数などを全角とみなす
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

/** 左右2段組。1行に収まらなければ右側を次行の右寄せにする。 */
export function twoCol(left: string, right: string, width: number): string {
  const gap = width - dispWidth(left) - dispWidth(right);
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  // 収まらない場合は右を次行へ
  const pad = Math.max(0, width - dispWidth(right));
  return `${left}\n${' '.repeat(pad)}${right}`;
}
