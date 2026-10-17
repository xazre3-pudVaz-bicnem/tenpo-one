/**
 * 画面のテンキー（components/ui/number-pad.tsx）の入力の決まり（純関数）。
 * 2026-10-17 Ronnie「レジ開局・クローズなどの数字は、iPad のキーボードではなく横のテンキーで入れる」
 */

export type PadDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type PadKey = PadDigit | '00' | 'back' | 'clear';

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

export function isPadDigit(key: string): key is PadDigit {
  return DIGITS.has(key);
}

/**
 * 今の値（数字だけの文字列。空＝未入力）にキーを1つ足す。
 * 頭の 0 は残さない（「0」→「5」は「5」）。maxDigits を超える桁は入らない。
 */
export function applyPadKey(value: string, key: PadKey, maxDigits = 9): string {
  if (key === 'clear') return '';
  if (key === 'back') return value.slice(0, -1);
  const next = (value + key).replace(/^0+(?=\d)/, '');
  return next.length > maxDigits ? value : next;
}

/** 表示用（3桁区切り）。空は空のまま */
export function padDisplay(value: string, grouped = false): string {
  if (!value) return '';
  return grouped ? Number(value).toLocaleString('ja-JP') : value;
}
