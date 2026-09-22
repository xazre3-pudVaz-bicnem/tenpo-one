import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * レジ（iPad）のログイン用パスワード。
 * 平文は保存せず scrypt のハッシュだけを store_register_credentials に置く。
 * 運営（TENPO ONE）だけが発行・変更する。店舗・オーナーは変えられない。
 *
 * node:crypto だけを使う（サーバー側でしか動かない）。画面側からは読み込まないこと。
 */

const KEY_LENGTH = 32;
const SCRYPT_N = 16384;

/** 現場で読み上げても間違えにくい文字だけ（0/O・1/l などを外す） */
const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 新しいレジ用パスワードを作る（初期は8文字） */
export function generateRegisterPassword(length = 8): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SAFE_CHARS[buf[i] % SAFE_CHARS.length];
  return out;
}

export function hashRegisterPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N }).toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

/** 保存したハッシュと突き合わせる（長さが違っても時間差が出ないようにする） */
export function verifyRegisterPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 1024) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[3], 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, parts[2], KEY_LENGTH, { N: n });
  } catch {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
