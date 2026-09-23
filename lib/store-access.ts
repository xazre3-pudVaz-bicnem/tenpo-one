/**
 * 店舗のアクセス制限（2026-09-23 要望。契約時に運営が設定する）。
 *
 * - レジ（iPad）・ハンディは「お店の回線」からだけ使える
 * - レジとして使える端末（iPad）の台数を契約で決める（既定2台）
 *
 * 設定は store_access_policies（運営だけが変更できる。migration 00070）。
 * 回線が未登録の店舗は制限なし＝今まで通り。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */
import { networkKey } from './handy-pairing';
import { isIpLiteral } from './handy-qr';

export interface AllowedNetwork {
  key: string;
  label: string;
}

export interface StoreAccessPolicy {
  /** 契約（store_access_policies の行）があるか。台数の制限はこれで効く */
  exists: boolean;
  networks: AllowedNetwork[];
  /** お店の回線からだけ使えるようにするか（運営が切り替える。既定はOFF） */
  networkEnforced: boolean;
  registerLimit: number;
  handyLimit: number;
  note: string;
}

export const DEFAULT_REGISTER_LIMIT = 2;
export const DEFAULT_HANDY_LIMIT = 2;
export const MAX_ALLOWED_NETWORKS = 10;

export const EMPTY_POLICY: StoreAccessPolicy = {
  exists: false,
  networks: [],
  networkEnforced: false,
  registerLimit: DEFAULT_REGISTER_LIMIT,
  handyLimit: DEFAULT_HANDY_LIMIT,
  note: '',
};

/** 台数の入力を 0〜20 に丸める（壊れた値は既定に戻す） */
export function limitFrom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(20, value) : fallback;
}

/** DB の行から読む（壊れた値は捨てる） */
export function policyFrom(
  row: {
    networks?: unknown;
    network_enforced?: unknown;
    register_limit?: unknown;
    handy_limit?: unknown;
    note?: unknown;
  } | null
): StoreAccessPolicy {
  if (!row) return EMPTY_POLICY;
  const networks = Array.isArray(row.networks)
    ? row.networks
        .map((n) => {
          const o = (n ?? {}) as Record<string, unknown>;
          return typeof o.key === 'string' && o.key
            ? { key: o.key.slice(0, 64), label: typeof o.label === 'string' ? o.label.slice(0, 60) : '' }
            : null;
        })
        .filter((n): n is AllowedNetwork => n !== null)
        .slice(0, MAX_ALLOWED_NETWORKS)
    : [];
  return {
    exists: true,
    networks,
    networkEnforced: row.network_enforced === true,
    registerLimit: limitFrom(row.register_limit, DEFAULT_REGISTER_LIMIT),
    handyLimit: limitFrom(row.handy_limit, DEFAULT_HANDY_LIMIT),
    note: typeof row.note === 'string' ? row.note : '',
  };
}

/** 入力された IP を回線（キー）に直す。IP として読めなければ null */
export function toNetwork(ip: string, label: string): AllowedNetwork | null {
  const trimmed = ip.trim();
  if (!isIpLiteral(trimmed)) return null;
  return { key: networkKey(trimmed), label: label.trim().slice(0, 60) };
}

/** この回線から使ってよいか。制限をかけていない店舗は常に true */
export function isAllowedNetwork(policy: StoreAccessPolicy, ip: string | null): boolean {
  if (!isRestricted(policy)) return true;
  if (!ip) return false;
  const key = networkKey(ip);
  return policy.networks.some((n) => n.key === key);
}

/** お店の回線でしか使えない店舗か（運営がONにして、回線を登録しているとき） */
export function isRestricted(policy: StoreAccessPolicy): boolean {
  return policy.networkEnforced && policy.networks.length > 0;
}

/**
 * レジ端末の台数を数えるかどうか。
 * 契約（store_access_policies の行）がある店舗だけ数える。
 * 契約のない既存の店舗は今まで通り台数の制限なし
 * （この機能を入れた瞬間に3台目のレジが開けなくなるのを防ぐため）。
 */
export function countsRegisterDevices(policy: StoreAccessPolicy): boolean {
  return policy.exists && policy.registerLimit > 0;
}

/** ハンディの台数を数えるか。レジと同じく、契約のある店舗だけ */
export function countsHandyDevices(policy: StoreAccessPolicy): boolean {
  return policy.exists && policy.handyLimit > 0;
}

/** ハンディをもう1台つないでよいか（既に使っている端末は数に入っている） */
export function canAddHandyDevice(policy: StoreAccessPolicy, activeCount: number): boolean {
  if (!countsHandyDevices(policy)) return true;
  return activeCount < policy.handyLimit;
}

export type RegisterDeviceDecision =
  | { kind: 'allowed' }
  | { kind: 'register' }
  | { kind: 'limit'; limit: number }
  | { kind: 'revoked' };

/**
 * この端末をレジとして使ってよいか。
 * - すでに登録済み（有効）: そのまま使える
 * - 解除された端末: 使えない
 * - 未登録: 台数に空きがあれば登録する。上限なら使えない
 */
export function decideRegisterDevice(opts: {
  known: { status: 'active' | 'revoked'; storeId: string } | null;
  storeId: string;
  activeCount: number;
  limit: number;
}): RegisterDeviceDecision {
  if (opts.known && opts.known.storeId === opts.storeId) {
    return opts.known.status === 'active' ? { kind: 'allowed' } : { kind: 'revoked' };
  }
  if (opts.activeCount >= opts.limit) return { kind: 'limit', limit: opts.limit };
  return { kind: 'register' };
}

export const REGISTER_COOKIE = 'tenpo_register_device';

export const ACCESS_MESSAGE = {
  network: 'お店の回線からのみ、レジ・ハンディを使えます（契約時に登録した回線）。お店のWi-Fi・有線につないでください',
  limit: 'この店舗で使えるレジ端末の台数の上限です。使わない端末の解除や台数の変更は、TENPO ONE のサポートへご連絡ください',
  handyLimit: 'この店舗で使えるハンディの台数の上限です。使わない端末の解除や台数の変更は、TENPO ONE のサポートへご連絡ください',
  revoked: 'この端末はレジとして解除されています。もう一度使うには、店舗の管理者に登録を依頼してください',
} as const;
