import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { HandyQrPanel } from '@/components/settings/handy-qr-panel';
import { handyQrFrom, isShopNetwork } from '@/lib/handy-qr';
import { currentRequestIp } from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { addCurrentShopNetwork, regenerateHandyQr, removeShopNetwork, setupHandyQr } from './actions';

export const metadata: Metadata = { title: 'iPhoneハンディ | 設定' };

/**
 * 設定 > iPhoneハンディ（全店舗共通の機能）。
 * 店ごとに1つの固定QRコード。お店のWi-Fiにつないだ iPhone で読むとハンディが開き、
 * Wi-Fi の外に3分いると自動でログアウトする。
 */
export default async function HandyQrPage() {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="iPhoneハンディ" en="Handy QR" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: row }, { count: activeDevices }, ip] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    supabase.from('handy_devices').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'active'),
    currentRequestIp(),
  ]);
  const qr = handyQrFrom(row?.settings ?? null);

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="iPhoneハンディ" en="Handy QR" description={`${store.name}・QRコードを読むだけでハンディが開く（お店のWi-Fiだけ）`} />
      <HandyQrPanel
        storeId={store.id}
        storeName={store.name}
        token={qr.token}
        networks={qr.networks}
        currentNetwork={ip ? networkKey(ip) : null}
        currentIsShop={isShopNetwork(qr, ip)}
        activeDevices={activeDevices ?? 0}
        setupAction={setupHandyQr}
        regenerateAction={regenerateHandyQr}
        addNetworkAction={addCurrentShopNetwork}
        removeNetworkAction={removeShopNetwork}
      />
    </div>
  );
}
