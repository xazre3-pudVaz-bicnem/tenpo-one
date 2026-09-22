/**
 * iPhone用ハンディ（2026-09-23 店舗要望）。
 *
 * - 店ごとに1つの「固定QRコード」（毎日は変えない。壁に貼っておける）
 * - お店のWi-Fiにつないだスマホで読むと、そのままハンディが開く（パスワードなし）
 * - お店のWi-Fiの外に出て 3 分たつと自動でログアウト（端末は解除。戻ったらQRを読み直す）
 *
 * 「お店のWi-Fi」は、ブラウザからは Wi-Fi の名前が読めないため、お店のインターネット回線
 * （接続元IP。IPv6 は上位64ビット）で判定する。回線はレジの画面（設定 > iPhone用ハンディ）から登録する。
 * 設定は store_settings.settings.handyQr（DB の列追加なし）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */
import { networkKey } from './handy-pairing';

/** Wi-Fi の外に出てからログアウトするまで */
export const HANDY_OUTSIDE_GRACE_MS = 3 * 60_000;
/** 外に出た時刻を覚えておく Cookie */
export const HANDY_OUTSIDE_COOKIE = 'tenpo_handy_outside';
/** 登録できる回線の数 */
export const MAX_SHOP_NETWORKS = 5;

export interface ShopNetwork {
  /** 回線のキー（IPv4 そのもの / IPv6 上位64ビット） */
  key: string;
  label: string;
  addedAt: string;
}

export interface HandyQrSettings {
  /** QR に入れる値（48桁の16進）。null はまだ作っていない */
  token: string | null;
  networks: ShopNetwork[];
}

export function isHandyQrToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{48}$/i.test(v);
}

/** store_settings.settings から読む（壊れた値は捨てる） */
export function handyQrFrom(settings: unknown): HandyQrSettings {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).handyQr : undefined;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const networks = Array.isArray(o.networks)
    ? o.networks
        .filter(
          (n): n is ShopNetwork =>
            !!n && typeof n === 'object' && typeof (n as ShopNetwork).key === 'string' && (n as ShopNetwork).key.length > 0
        )
        .map((n) => ({
          key: n.key.slice(0, 64),
          label: typeof n.label === 'string' ? n.label.slice(0, 40) : '',
          addedAt: typeof n.addedAt === 'string' ? n.addedAt : '',
        }))
        .slice(0, MAX_SHOP_NETWORKS)
    : [];
  return { token: isHandyQrToken(o.token) ? o.token.toLowerCase() : null, networks };
}

/** 回線を追加（同じ回線は1つだけ。多すぎれば古いものから消す） */
export function addShopNetwork(s: HandyQrSettings, ip: string, label: string, nowIso: string): HandyQrSettings {
  const key = networkKey(ip);
  if (s.networks.some((n) => n.key === key)) return s;
  const networks = [...s.networks, { key, label: label.trim().slice(0, 40), addedAt: nowIso }];
  return { ...s, networks: networks.slice(-MAX_SHOP_NETWORKS) };
}

/** お店のWi-Fi（登録した回線）からか。IP が取れなければ false */
export function isShopNetwork(s: HandyQrSettings, ip: string | null): boolean {
  if (!ip) return false;
  const key = networkKey(ip);
  return s.networks.some((n) => n.key === key);
}

/** Wi-Fi の外にいるときの判定。Wi-Fi 判定をしない店（回線未登録）は常に ok */
export type OutsideDecision =
  | { kind: 'ok' }
  | { kind: 'outside'; since: number; remainingMs: number }
  | { kind: 'logout' };

export function decideOutside(opts: {
  guarded: boolean;
  inside: boolean;
  outsideSince: number | null;
  now: number;
}): OutsideDecision {
  if (!opts.guarded || opts.inside) return { kind: 'ok' };
  const since = opts.outsideSince !== null && opts.outsideSince <= opts.now ? opts.outsideSince : opts.now;
  const elapsed = opts.now - since;
  if (elapsed >= HANDY_OUTSIDE_GRACE_MS) return { kind: 'logout' };
  return { kind: 'outside', since, remainingMs: HANDY_OUTSIDE_GRACE_MS - elapsed };
}

/** Cookie の値（外に出た時刻 ms）を読む */
export function parseOutsideSince(v: string | undefined | null): number | null {
  if (!v || !/^\d{10,16}$/.test(v)) return null;
  return Number(v);
}

/** QR の URL（トークンは # 以降に入れる＝サーバーのアクセスログに残さない） */
export function handyQrUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, '')}/handy-join#${token}`;
}

/** IPv4 / IPv6 として読める値か（レジの画面から送られた回線の確認用） */
export function isIpLiteral(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 45) return false;
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) return true;
  return /^[0-9a-f:]+$/i.test(v) && v.includes(':') && v.split('::').length <= 2;
}
