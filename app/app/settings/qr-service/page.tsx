import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { QrServiceEditor } from '@/components/settings/qr-service-editor';
import { qrServiceFrom } from '@/lib/qr-service';

export const metadata: Metadata = { title: 'お客様QRのサービス | 設定' };

/**
 * お客様QRの「サービス」（お水・お箸・取り皿交換など、無料で頼めるもの）の一覧（店長以上）。
 * お客様QRのメニューの最後のタブと呼び出しタブに出て、頼まれるとスタッフ呼び出しとしてハンディ・レジに届く
 * （2026-10-18 Ronnie「QR の最後に SERVICE ボタン。全店舗で追加できるように」）。
 */
export default async function QrServiceSettingsPage() {
  const ctx = await requirePermission('menu.manage');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="お客様QRのサービス" en="QR service" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
  const initial = qrServiceFrom((data as { settings?: unknown } | null)?.settings ?? null);
  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="お客様QRのサービス"
        en="QR service"
        description={`${store.name}｜お水・お箸・取り皿交換など、お客様がQRから無料で頼めるもの。頼まれるとスタッフ呼び出しとしてハンディ・レジに届きます（注文・お会計には入りません）`}
      />
      <QrServiceEditor key={store.id} storeId={store.id} initial={initial} />
    </div>
  );
}
