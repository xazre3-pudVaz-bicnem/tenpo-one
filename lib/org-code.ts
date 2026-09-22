/**
 * 企業番号（レジのログインで打つ番号。2026-09-23 要望）。
 *
 * 形は6桁の数字だけ（例: 184203）。会社を追加したときに自動で発行する。
 * 数字だけにしているのは、iPad のテンキーで打てるようにするため（USEN などと同じ形）。
 * 秘密ではない（秘密なのは店舗ごとの「レジ用パスワード」の方）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export const ORG_CODE_DIGITS = 6;
const PATTERN = new RegExp(`^[0-9]{${ORG_CODE_DIGITS}}$`);

/** ランダムな企業番号を1つ作る（重複は呼び出し側でやり直す） */
export function generateOrgCode(random: () => number = Math.random): string {
  const max = 10 ** ORG_CODE_DIGITS;
  const n = Math.floor(random() * max) % max;
  return String(n).padStart(ORG_CODE_DIGITS, '0');
}

/**
 * 打ち間違いを吸収して比べられる形に直す。
 * 全角数字・空白・ハイフンで打たれても通るようにする。
 */
export function normalizeOrgCode(input: string): string {
  return input.normalize('NFKC').replace(/[\s　-]/g, '');
}

/** 企業番号の形をしているか */
export function isOrgCode(input: string): boolean {
  return PATTERN.test(normalizeOrgCode(input));
}
