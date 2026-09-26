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
  /**
   * 全角1文字に足す物理幅（半角桁）。
   * Star mC-Print3 は全角文字が半角2桁よりわずかに広く印字されるため、全角を含む48桁ぴったりの行は
   * 末尾の1文字だけが次行に落ちる（御茶ノ水の実機レシートで確認: 「小計 ¥10,54 / 5」「合計 ¥11,60 / 0」、
   * 住所の「4F」の F だけが次行）。桁揃え・折り返しの計算でこの分を見込み、行を用紙幅に収める。
   */
  cjkExtra?: number;
}

/** Star 機（CloudPRNT の Markup / StarPRNT）向けの桁揃え前提。実機の折り返し位置から全角≒2.17桁と見積もった */
export const STAR_WIDTH_OPTIONS: WidthOptions = { cjkExtra: 0.17 };

/** 表示幅（CJK全角=2, その他=1）。二段組の桁揃えに使う。 */
export function dispWidth(s: string, options: WidthOptions = {}): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '¥' || ch === '￥') {
      w += options.yenFullWidth ? 2 + (options.cjkExtra ?? 0) : 1;
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
    w += wide ? 2 + (options.cjkExtra ?? 0) : 1;
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
        // 直前にスペースがあればそこで折る（住所の「4F」の F だけが次行に落ちる、を避ける）
        const sp = breakAtSpace(line);
        if (sp > 0) {
          out.push(line.slice(0, sp).trimEnd());
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * 折り返し位置に使うスペースの位置を返す（無ければ -1）。
 * 末尾から16文字以内の最後のスペースを使う。その後ろが短すぎる（「4F」の「4」だけ等）ときは
 * ひとつ前のスペースまで戻して「第87東京ビル 4F」ごと次行へ送る。
 */
function breakAtSpace(line: string): number {
  let sp = line.lastIndexOf(' ');
  if (sp <= 0 || line.length - sp > 16) return -1;
  if (line.length - sp - 1 < 3) {
    const prev = line.lastIndexOf(' ', sp - 1);
    if (prev > 0 && line.length - prev <= 24) sp = prev;
  }
  return sp;
}

/** 左右2段組。1行に収まらなければ右側を次行の右寄せにする。 */
export function twoCol(left: string, right: string, width: number, options: WidthOptions = {}): string {
  // cjkExtra で幅が小数になるので、詰め物は切り捨てて用紙幅を超えないようにする
  const gap = Math.floor(width - dispWidth(left, options) - dispWidth(right, options));
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  // 収まらない場合は右を次行へ
  const pad = Math.max(0, Math.floor(width - dispWidth(right, options)));
  return `${left}\n${' '.repeat(pad)}${right}`;
}

/**
 * お会計伝票に出す明細だけを選ぶ。
 *
 * 飲み放題・食べ放題・コースの中身は 0円で伝票に積まれるため、そのまま印字すると
 * お客様の「お会計伝票」が 0円の行で埋まってしまう
 * （2026-09-25 店舗要望 FULL MOoN 御茶ノ水「¥0のオーダーも印字されるので出ないように」）。
 * 金額の付いた行（本体または選択肢に値段があるもの）だけを残す。
 *
 * ただし 0円の行しか無い伝票（コース代が別会計など）は空の伝票になってしまうので、
 * その場合だけ元の明細をそのまま返す。
 */
export function billSlipLines<T extends { lineTotal: number; modifiers?: { price: number }[] }>(lines: T[]): T[] {
  const priced = lines.filter(
    (l) => l.lineTotal !== 0 || (l.modifiers ?? []).some((m) => (m.price ?? 0) !== 0)
  );
  return priced.length > 0 ? priced : lines;
}

/**
 * 領収書の印鑑欄（2026-09-26 Ronnie「印鑑押すところも作って」）。
 * 罫線素片（JIS）で右寄せの枠を描く。全角8文字（16桁）×5行 ≒ 24mm×19mm（80mm紙）で、認印・角印が収まる。
 * 罫線素片は Star・EPSON とも Shift_JIS の漢字フォントに入っている。右寄せは半角スペースの左詰めで行う。
 */
export const STAMP_BOX_COLS = 16;
export function stampBoxLines(width: number, label = '印'): string[] {
  const inner = 6; // 全角
  const pad = ' '.repeat(Math.max(0, width - STAMP_BOX_COLS));
  const blank = '　'.repeat(inner);
  const labelLine = '　'.repeat(2) + label + '　'.repeat(inner - 2 - 1);
  return [
    `${pad}┌${'─'.repeat(inner)}┐`,
    `${pad}│${labelLine}│`,
    `${pad}│${blank}│`,
    `${pad}│${blank}│`,
    `${pad}└${'─'.repeat(inner)}┘`,
  ];
}
