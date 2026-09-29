/**
 * 即会計（電卓のレジのように金額だけで会計する）の決まりごと。純粋な関数だけ（テスト対象）。
 * 2026-09-30 Ronnie「手書きの伝票の合計だけで会計するお店のため。税込で入れた金額がそのまま」。
 */

/** 明細・伝票メモに出す名前（レシートにもこの名前で出る） */
export const QUICK_PAY_LINE_NAME = '即会計';

/** 入れた金額は税込。税率は店内の標準 10%（2026-09-30 Ronnie「税込なので選ばなくていい。入れた金額がそのまま」） */
export const QUICK_PAY_TAX_RATE = 10;

/** 1回に入れられる金額の上限（1行） */
export const QUICK_PAY_MAX_AMOUNT = 9_999_999;

/** 1回の会計で入れられる行の上限 */
export const QUICK_PAY_MAX_LINES = 50;

/** 「×」で入れる個数の上限（530 × 2 のように。2026-09-30 Ronnie） */
export const QUICK_PAY_MAX_QUANTITY = 99;

/** 電卓で入れた1行（単価 × 個数。「×」を使わなければ個数 1） */
export interface QuickPayLine {
  amount: number;
  quantity: number;
}

/** 金額の行を確かめる。問題なければ null */
export function quickPayProblem(lines: readonly QuickPayLine[]): string | null {
  if (lines.length > QUICK_PAY_MAX_LINES) return `一度に入れられるのは${QUICK_PAY_MAX_LINES}行までです`;
  for (const { amount: a, quantity: q } of lines) {
    if (!Number.isInteger(a) || a <= 0) return '金額は1円以上の整数で入れてください';
    if (a > QUICK_PAY_MAX_AMOUNT) return `1行の金額は${QUICK_PAY_MAX_AMOUNT.toLocaleString('ja-JP')}円までです`;
    if (!Number.isInteger(q) || q < 1 || q > QUICK_PAY_MAX_QUANTITY) {
      return `個数は1〜${QUICK_PAY_MAX_QUANTITY}で入れてください`;
    }
  }
  return null;
}

