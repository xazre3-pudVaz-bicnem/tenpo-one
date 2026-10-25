/**
 * ディスプレイ端末のQRペアリング（純関数・テスト対象。サーバー側だけで使う＝node:crypto を含む）。
 * 規則はハンディ端末（lib/handy-pairing.ts）と同じ:
 *   - コードは 48桁の16進。DB にはハッシュだけを入れる
 *   - 5分・1回限り
 *   - QR を表示したレジと同じ回線（IPv4 はそのまま・IPv6 は上位64ビット）からだけ成立
 * ちがうのは文言と、ログイン後に「ログアウトしない」こと（端末の鍵 Cookie でつなぎ直す）。
 */
import { createHash, randomBytes } from 'node:crypto';
import { pairingFailure, type PairingFailure } from './handy-pairing';

export { clientIpFrom, generatePairingCode, hashPairingCode, isPairingCode, isSameNetwork, PAIRING_TTL_MS } from './handy-pairing';
export type { PairingFailure } from './handy-pairing';

/** 失効の理由。まだ有効なら null（規則はハンディと同じ: 未使用・期限内・発行したレジと同じ回線） */
export function displayPairingFailure(
  pairing: { expiresAt: number; usedAt: number | null; issuedIp: string | null } | null,
  now: number,
  currentIp: string | null
): PairingFailure | null {
  return pairingFailure(pairing, now, currentIp);
}

export const DISPLAY_PAIRING_FAILURE_MESSAGE: Record<PairingFailure, string> = {
  NOT_FOUND: 'このQRコードは使えません。設定 → ディスプレイ端末 で新しいQRコードを表示してください',
  EXPIRED: 'QRコードの有効期限が切れました。設定 → ディスプレイ端末 で新しいQRコードを表示してください',
  USED: 'このQRコードは使用済みです。設定 → ディスプレイ端末 で新しいQRコードを表示してください',
  DIFFERENT_NETWORK:
    'お店の回線（QRコードを表示したレジと同じWi-Fi・有線）につないでから読み取ってください（モバイル回線ではつなげません）',
};

/** 端末用ログインアカウントのメールアドレス（実際には受信しない。端末の識別にだけ使う） */
export function displayDeviceEmail(deviceKey: string): string {
  return `display-${deviceKey}@devices.tenpo-one.com`;
}

/** セッションが切れたときにつなぎ直すための端末の鍵（Cookie・httpOnly）。48桁の16進 */
export const DISPLAY_DEVICE_COOKIE = 'tenpo_display_device';
/** Cookie の寿命（ブラウザの上限 400 日。開いている間は数分ごとに延ばす） */
export const DISPLAY_DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export function generateDisplayDeviceToken(): string {
  return randomBytes(24).toString('hex');
}

export function isDisplayDeviceToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{48}$/i.test(v);
}

/** 端末の鍵は平文で保存しない */
export function hashDisplayDeviceToken(token: string): string {
  return createHash('sha256').update(`display-device:${token.toLowerCase()}`).digest('hex');
}
