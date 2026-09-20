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

/**
 * 桁揃えの前提。
 * EPSON機（ePOS-Print / 日本語フォント）は「¥」を全角幅で印字するため、半角として数えると
 * 行が1桁ずつはみ出して末尾が折り返す（御茶ノ水の実機で確認）。Star機はCP932の半角￥なので1桁。
 */
export interface WidthOptions {
  /** 「¥」を全角（2桁）として数える */
  yenFullWidth?: boolean;
}

/** 表示幅（CJK全角=2, その他=1）。二段組の桁揃えに使う。 */
export function dispWidth(s: string, options: WidthOptions = {}): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '¥' || ch === '￥') {
      w += options.yenFullWidth ? 2 : 1;
      continue;
    }
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

/**
 * 長い文章を桁数で折り返す。
 * プリンタ任せの折り返しだと、1文字だけ次行に落ちるなど不格好になるため、こちらで区切る
 * （店舗住所・フッター文・長い商品名など）。
 */
export function wrapText(text: string, width: number, options: WidthOptions = {}): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (dispWidth(next, options) > width) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/** 左右2段組。1行に収まらなければ右側を次行の右寄せにする。 */
export function twoCol(left: string, right: string, width: number, options: WidthOptions = {}): string {
  const gap = width - dispWidth(left, options) - dispWidth(right, options);
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  // 収まらない場合は右を次行へ
  const pad = Math.max(0, width - dispWidth(right, options));
  return `${left}\n${' '.repeat(pad)}${right}`;
}
