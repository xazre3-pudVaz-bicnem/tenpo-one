import { isIpLiteral, type ShopNetwork } from '@/lib/handy-qr';

/**
 * iPad アプリのネイティブの「設定 › iPhoneハンディ」（QR の作成・作り直し・お店の Wi-Fi・印刷）。
 * 2026-10-25 Ronnie「Make everything 101% native. We no longer need the Web iPad version」。
 * 今まではネイティブの QR の画面の「QR の作り直し・Wi-Fi の設定」が Web の /app/settings/handy-qr を開こうとして、
 * 同じネイティブの画面に戻るだけだった（作り直し・Wi-Fi の設定が iPad でできなかった）。
 *
 * 読み込みは GET /api/app/v1/pos?part=handyQrAdmin、操作は POST { type: 'handyQr…' }（lib/native-modules/handy-qr.ts）。
 * 中身は Web と同じ Server Action（app/app/settings/handy-qr/actions.ts）を呼ぶだけ。ここは送られてきた中身の確かめ（純粋な関数）。
 */

/** POST の type（どれも Web の設定 › iPhoneハンディ と同じ操作） */
export const NATIVE_HANDY_QR_TYPES = ['handyQrSetup', 'handyQrRegenerate', 'handyQrNetworkAdd', 'handyQrNetworkRemove', 'handyQrWifiOnly'] as const;
export type NativeHandyQrType = (typeof NATIVE_HANDY_QR_TYPES)[number];

export type NativeHandyQrAction =
  /** QR を作る（はじめて）。この iPad の回線を「お店のWi-Fi」として登録する */
  | { type: 'handyQrSetup'; extraIps: string[] }
  /** QR を作り直す（古い QR では開けなくなり、ログイン中のハンディも全部解除） */
  | { type: 'handyQrRegenerate' }
  /** この iPad の回線を「お店のWi-Fi」に追加 */
  | { type: 'handyQrNetworkAdd'; label: string; extraIps: string[] }
  /** 登録した回線を外す */
  | { type: 'handyQrNetworkRemove'; key: string }
  /** 「お店のWi-Fiだけで使う」のオン・オフ */
  | { type: 'handyQrWifiOnly'; wifiOnly: boolean };

/** iPad が調べたこの回線の IPv4 / IPv6（api.ipify.org。Web のレジの画面と同じ）。形だけ確かめて 2 つまで */
export function handyQrExtraIps(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isIpLiteral).slice(0, 2) : [];
}

export function isNativeHandyQrType(v: unknown): v is NativeHandyQrType {
  return typeof v === 'string' && (NATIVE_HANDY_QR_TYPES as readonly string[]).includes(v);
}

export function parseNativeHandyQrAction(raw: unknown): { ok: true; value: NativeHandyQrAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'handyQrSetup':
      return { ok: true, value: { type: 'handyQrSetup', extraIps: handyQrExtraIps(b.extraIps) } };
    case 'handyQrRegenerate':
      return { ok: true, value: { type: 'handyQrRegenerate' } };
    case 'handyQrNetworkAdd': {
      const label = typeof b.label === 'string' ? b.label.trim().slice(0, 40) : '';
      return { ok: true, value: { type: 'handyQrNetworkAdd', label, extraIps: handyQrExtraIps(b.extraIps) } };
    }
    case 'handyQrNetworkRemove': {
      const key = typeof b.key === 'string' ? b.key.trim() : '';
      if (!key || key.length > 64) return { ok: false, error: '外す回線を選んでください' };
      return { ok: true, value: { type: 'handyQrNetworkRemove', key } };
    }
    case 'handyQrWifiOnly':
      if (typeof b.wifiOnly !== 'boolean') return { ok: false, error: 'オン・オフを選んでください' };
      return { ok: true, value: { type: 'handyQrWifiOnly', wifiOnly: b.wifiOnly } };
    default:
      return { ok: false, error: '知らない操作です' };
  }
}

/** GET part=handyQrAdmin の返事（Web の HandyQrPanel に渡しているものと同じ中身。QR の値そのものではなく URL を渡す） */
export interface NativeHandyQrAdminPayload {
  store: { id: string; name: string };
  /** QR に入れる URL（/handy-join#<値>）。まだ作っていなければ null */
  url: string | null;
  wifiOnly: boolean;
  networks: ShopNetwork[];
  /** この iPad の回線（IPv4 / IPv6 の上位64ビット）。分からなければ null */
  currentNetwork: string | null;
  /** この iPad の回線が「お店のWi-Fi」に登録済みか */
  currentIsShop: boolean;
  /** いまログインしているハンディの台数 */
  activeDevices: number;
  /** 登録できる回線の数 */
  maxNetworks: number;
}
