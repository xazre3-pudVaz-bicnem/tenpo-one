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

/** 表記ゆれを吸収する（小文字化・IPv4射影アドレス・ポート付き） */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  // "[2001:db8::1]:1234" → 中身だけ
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  // "203.0.113.5:1234"（IPv4 にポート）→ ポートを落とす
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];
  // "::ffff:203.0.113.5"（IPv4 射影）→ IPv4
  if (ip.startsWith('::ffff:') && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

/** IPv6 を 8 ブロック・各4桁に展開する。読めない値は null */
function expandIpv6(ip: string): string[] | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return null;
  const full = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (full.length !== 8 || full.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return full.map((h) => h.padStart(4, '0'));
}

/**
 * 「同じ回線」を表すキー。
 * IPv4 はルーターの下の端末が全部同じグローバル IP になる（NAT）のでそのまま。
 * IPv6 は端末ごとにアドレスが違うが、同じ回線なら上位 64 ビット（プレフィックス）が同じなので、そこだけ使う。
 */
export function networkKey(ip: string): string {
  const n = normalizeIp(ip);
  if (!n.includes(':')) return n;
  const expanded = expandIpv6(n);
  return expanded ? expanded.slice(0, 4).join(':') : n;
}

/**
 * 同じ回線（＝同じWi-Fi）から来ているか。
 * 判定はペアリングの瞬間だけに使う。IPが取れない場合は同じとみなさない（黙って通さない）。
 * IPv6 の店（レジとスマホで末尾が違う）でも登録できるよう、IPv6 は上位 64 ビットで比べる。
 */
export function isSameNetwork(issuedIp: string | null, currentIp: string | null): boolean {
  if (!issuedIp || !currentIp) return false;
  return networkKey(issuedIp) === networkKey(currentIp);
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
