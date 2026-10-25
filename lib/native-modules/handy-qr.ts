import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { handyQrFrom, handyQrUrl, isShopNetwork, MAX_SHOP_NETWORKS } from '@/lib/handy-qr';
import { currentRequestIp } from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { parseNativeHandyQrAction, type NativeHandyQrAdminPayload } from '@/lib/native-handy-qr';
import {
  addCurrentShopNetwork,
  regenerateHandyQr,
  removeShopNetwork,
  setHandyWifiOnly,
  setupHandyQr,
} from '@/app/app/settings/handy-qr/actions';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 設定 › iPhoneハンディ の iPad ネイティブ（GET part=handyQrAdmin ／ POST { type: 'handyQrSetup' | 'handyQrRegenerate' | … }）。
 * 中身・操作・権限（store.settings）は Web の /app/settings/handy-qr と同じ（page.tsx の読み込み・actions.ts の Server Action）。
 * 回線は「いま操作している端末の接続元」（currentRequestIp）＝お店の Wi-Fi につないだレジの iPad から操作する（Web と同じ）。
 * 2026-10-25 Ronnie「Make everything 101% native」
 */

const NO_PERMISSION: NativeModuleResult = { status: 403, body: { ok: false, error: '店舗の設定を変える権限がありません' } };

export const handyQrAdminGet: NativeModuleGet = async ({ ctx, store }) => {
  if (!can(ctx.role, 'store.settings')) return NO_PERMISSION;
  const supabase = await createClient();
  const [{ data: row }, { count: activeDevices }, ip, origin] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    supabase.from('handy_devices').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'active'),
    currentRequestIp(),
    resolveSiteOrigin(),
  ]);
  const qr = handyQrFrom(row?.settings ?? null);
  const payload: NativeHandyQrAdminPayload = {
    store,
    url: qr.token ? handyQrUrl(origin, qr.token) : null,
    wifiOnly: qr.wifiOnly,
    networks: qr.networks,
    currentNetwork: ip ? networkKey(ip) : null,
    currentIsShop: isShopNetwork(qr, ip),
    activeDevices: activeDevices ?? 0,
    maxNetworks: MAX_SHOP_NETWORKS,
  };
  return { body: { ok: true, ...payload } };
};

/** 1 つの操作（どれも Web と同じ Server Action。店舗は今の店舗） */
export const handyQrAdminPost: NativeModulePost = async ({ ctx, raw, store }) => {
  if (!can(ctx.role, 'store.settings')) return NO_PERMISSION;
  const parsed = parseNativeHandyQrAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const a = parsed.value;
  let r: { error?: string };
  switch (a.type) {
    case 'handyQrSetup':
      r = await setupHandyQr(store.id, a.extraIps);
      break;
    case 'handyQrRegenerate':
      r = await regenerateHandyQr(store.id);
      break;
    case 'handyQrNetworkAdd':
      r = await addCurrentShopNetwork(store.id, a.label, a.extraIps);
      break;
    case 'handyQrNetworkRemove':
      r = await removeShopNetwork(store.id, a.key);
      break;
    case 'handyQrWifiOnly':
      r = await setHandyWifiOnly(store.id, a.wifiOnly);
      break;
  }
  return r.error ? { status: 400, body: { ok: false, error: r.error } } : { body: { ok: true } };
};
