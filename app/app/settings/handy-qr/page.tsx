import type { Metadata } from 'next';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
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

      {/* メニュー一覧から「ハンディ」を外したので、この画面からそのまま開けるようにする（2026-09-23 要望） */}
      <div className="mt-5 rounded-xl border border-line bg-white px-4 py-4">
        <p className="text-sm font-semibold text-navy">この端末でハンディを開く</p>
        <p className="mt-1 text-xs text-gray-500">
          QRコードを使わずに、いま使っている端末でそのままハンディを開きます。
        </p>
        <Link
          href="/handy"
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-deep"
        >
          <Smartphone className="h-4 w-4" aria-hidden />
          ハンディを開く
        </Link>
      </div>
    </div>
  );
}
