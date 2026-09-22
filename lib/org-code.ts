/**
 * 企業番号（レジのログインで打つ番号。2026-09-23 要望）。
 *
 * 形は t1 + 5桁の数字（例: t184203）。会社を追加したときに自動で発行する。
 * 秘密ではない（秘密なのは店舗ごとの「レジ用パスワード」の方）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export const ORG_CODE_PREFIX = 't1';
export const ORG_CODE_DIGITS = 5;
const PATTERN = new RegExp(`^${ORG_CODE_PREFIX}[0-9]{${ORG_CODE_DIGITS}}$`);

/** ランダムな企業番号を1つ作る（重複は呼び出し側でやり直す） */
export function generateOrgCode(random: () => number = Math.random): string {
  const max = 10 ** ORG_CODE_DIGITS;
  const n = Math.floor(random() * max) % max;
  return ORG_CODE_PREFIX + String(n).padStart(ORG_CODE_DIGITS, '0');
}

/**
 * 打ち間違いを吸収して比べられる形に直す。
 * 大文字・空白・全角数字で打たれても通るようにする。
 */
export function normalizeOrgCode(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\s　-]/g, '')
    .toLowerCase();
}

/** 企業番号の形をしているか */
export function isOrgCode(input: string): boolean {
  return PATTERN.test(normalizeOrgCode(input));
}
