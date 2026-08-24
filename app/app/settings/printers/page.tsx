import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsBackLink } from '@/components/settings/back-link';
import { RegistersPanel } from '@/components/settings/registers-panel';
import { PrintersPanel } from '@/components/settings/printers-panel';
import { DrawerPanel } from '@/components/settings/drawer-panel';
import { CloudPrntPanel } from '@/components/settings/cloudprnt-panel';

export const metadata: Metadata = { title: 'レジ・プリンター | 設定' };

export default async function PrintersSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="レジ・プリンター" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: registers } = await supabase
    .from('registers')
    .select('id, name, status')
    .eq('store_id', targetStore.id)
    .neq('status', 'deleted')
    .order('name');

  const { data: printers } = await supabase
    .from('printer_configs')
    .select('id, name, maker, model, connection_type, ip_address, usage, paper_width_mm, auto_print, drawer_kick, is_verified, cloudprnt_enabled, cloudprnt_token, drawer_command, poll_interval_seconds, last_polled_at')
    .eq('store_id', targetStore.id)
    .eq('status', 'active')
    .order('name');

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const cloudPrntRows = (printers ?? [])
    .filter((p) => p.usage === 'receipt')
    .map((p) => ({
      id: p.id,
      name: p.name,
      cloudprntEnabled: p.cloudprnt_enabled ?? false,
      cloudprntToken: p.cloudprnt_token ?? null,
      drawerKick: p.drawer_kick,
      drawerCommand: p.drawer_command ?? '[drawer: 1]',
      paperWidthMm: p.paper_width_mm,
      pollIntervalSeconds: p.poll_interval_seconds ?? 5,
      lastPolledAt: p.last_polled_at ?? null,
    }));

  const { data: settingsRow } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', targetStore.id)
    .maybeSingle();
  const drawer = (settingsRow?.settings as { drawer?: { autoOpenOnCash?: boolean; openOnCashless?: boolean } } | null)
    ?.drawer;
  const drawerInitial = {
    autoOpenOnCash: drawer?.autoOpenOnCash ?? true,
    openOnCashless: drawer?.openOnCashless ?? false,
  };

  const registerRows = (registers ?? []).map((r) => ({ id: r.id, name: r.name, status: r.status as 'active' | 'inactive' }));

  const printerRows = (printers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    maker: p.maker ?? '',
    model: p.model ?? '',
    connectionType: p.connection_type ?? 'browser',
    ipAddress: p.ip_address ?? '',
    usage: p.usage,
    paperWidthMm: p.paper_width_mm,
    autoPrint: p.auto_print,
    drawerKick: p.drawer_kick,
    isVerified: p.is_verified,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="レジ・プリンター" description={targetStore.name} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <RegistersPanel storeId={targetStore.id} initial={registerRows} />
          <DrawerPanel storeId={targetStore.id} initial={drawerInitial} />
        </div>
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardContent>
              <PrintersPanel storeId={targetStore.id} initial={printerRows} />
            </CardContent>
          </Card>
          <CloudPrntPanel storeId={targetStore.id} siteUrl={siteUrl} printers={cloudPrntRows} />
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            レシート印字は上の「CloudPRNT」（Star mC-Print3 等）で実機印字に対応します。CloudPRNT未対応機や未設定時は、レシート画面からのブラウザ印刷が利用できます。
          </div>
        </div>
      </div>
    </div>
  );
}
