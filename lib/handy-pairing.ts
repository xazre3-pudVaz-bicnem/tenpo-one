/**
 * ハンディ端末のQRペアリングの共通ロジック（純関数・テスト対象）。
 * DBやNextに依存しないものだけを置く。
 */
import { createHash, randomBytes } from 'node:crypto';

/** QRの有効時間。現場で読み取るまでの猶予として5分 */
export const PAIRING_TTL_MS = 5 * 60_000;

/** ペアリングコード（QRに入れる値）。URLに入れるので16進で作る */
export function generatePairingCode(): string {
  return randomBytes(24).toString('hex');
}

/** コードは平文で保存しない。照合はハッシュで行う */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** QRに入れる値として妥当な形か（48桁の16進） */
export function isPairingCode(value: string): boolean {
  return /^[0-9a-f]{48}$/i.test(value);
}

/**
 * 接続元IP。Vercel経由では x-forwarded-for の先頭が実際の接続元。
 * 取れないときは null（＝同じ回線か判定できない）。
 */
export function clientIpFrom(headerValues: { forwardedFor?: string | null; realIp?: string | null }): string | null {
  const first = headerValues.forwardedFor?.split(',')[0]?.trim();
  const ip = first || headerValues.realIp?.trim() || '';
  return ip.length > 0 ? ip : null;
}

/**
 * 同じ回線（＝同じWi-Fi）から来ているか。
 * 判定はペアリングの瞬間だけに使う。IPが取れない場合は同じとみなさない（黙って通さない）。
 */
export function isSameNetwork(issuedIp: string | null, currentIp: string | null): boolean {
  if (!issuedIp || !currentIp) return false;
  return issuedIp === currentIp;
}

export type PairingFailure = 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'DIFFERENT_NETWORK';

/** 失効の理由。まだ有効なら null */
export function pairingFailure(
  pairing: { expiresAt: number; usedAt: number | null; issuedIp: string | null } | null,
  now: number,
  currentIp: string | null
): PairingFailure | null {
  if (!pairing) return 'NOT_FOUND';
  if (pairing.usedAt !== null) return 'USED';
  if (pairing.expiresAt <= now) return 'EXPIRED';
  if (!isSameNetwork(pairing.issuedIp, currentIp)) return 'DIFFERENT_NETWORK';
  return null;
}

export const PAIRING_FAILURE_MESSAGE: Record<PairingFailure, string> = {
  NOT_FOUND: 'このQRコードは使えません。レジの画面で新しいQRコードを表示してください',
  EXPIRED: 'QRコードの有効期限が切れました。レジの画面で新しいQRコードを表示してください',
  USED: 'このQRコードは使用済みです。レジの画面で新しいQRコードを表示してください',
  DIFFERENT_NETWORK:
    'お店のWi-Fiに接続してから読み取ってください（スマホの回線では設定できません）',
};

/** 端末用ログインアカウントのメールアドレス（実際には受信しない。端末の識別にだけ使う） */
export function handyDeviceEmail(deviceKey: string): string {
  return `handy-${deviceKey}@devices.tenpo-one.com`;
}
