import type { Metadata } from 'next';
import QRCode from 'qrcode';
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
import Link from 'next/link';
import { KitchenTicketPanel } from '@/components/settings/kitchen-ticket-panel';
import { kitchenTicketSettingsFrom, misroutedDrinkCategories } from '@/lib/kitchen-ticket';
import { normalizeFloorIds } from '@/lib/printer-floors';

export const metadata: Metadata = { title: 'レジ・プリンター | 設定' };

export default async function PrintersSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="レジ・プリンター" en="Registers & printers" />
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
    .select('id, name, maker, model, connection_type, ip_address, usage, paper_width_mm, auto_print, drawer_kick, is_verified, cloudprnt_enabled, cloudprnt_token, drawer_command, poll_interval_seconds, last_polled_at, mac_address, kitchen_stations, floor_ids, bill_slips, upside_down')
    .eq('store_id', targetStore.id)
    .eq('status', 'active')
    .order('name');

  const { data: floorRows } = await supabase
    .from('floors')
    .select('id, name')
    .eq('store_id', targetStore.id)
    .eq('status', 'active')
    .order('sort_order')
    .order('name');
  const floors = (floorRows ?? []).map((f) => ({ id: f.id as string, name: f.name as string }));

  // 未印刷のまま待っているジョブ数（プリンタ未接続の気付きのため）
  const { data: pendingJobs } = await supabase
    .from('print_jobs')
    .select('printer_config_id')
    .eq('store_id', targetStore.id)
    .eq('target', 'cloudprnt')
    .in('status', ['queued', 'claimed']);
  const pendingByPrinter = new Map<string, number>();
  for (const j of pendingJobs ?? []) {
    if (!j.printer_config_id) continue;
    pendingByPrinter.set(j.printer_config_id, (pendingByPrinter.get(j.printer_config_id) ?? 0) + 1);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const cloudPrntRows = (printers ?? [])
    .filter((p) => p.usage === 'receipt' || p.usage === 'kitchen')
    // レシート機を先に並べる
    .sort((a, b) => Number(a.usage !== 'receipt') - Number(b.usage !== 'receipt'))
    .map((p) => ({
      id: p.id,
      name: p.name,
      maker: p.maker ?? '',
      model: p.model ?? '',
      usage: p.usage as 'receipt' | 'kitchen',
      cloudprntEnabled: p.cloudprnt_enabled ?? false,
      cloudprntToken: p.cloudprnt_token ?? null,
      drawerKick: p.drawer_kick,
      drawerCommand: p.drawer_command ?? '[drawer: 1]',
      paperWidthMm: p.paper_width_mm,
      pollIntervalSeconds: p.poll_interval_seconds ?? 5,
      lastPolledAt: p.last_polled_at ?? null,
      macAddress: p.mac_address ?? null,
      kitchenStations: (p.kitchen_stations ?? ['kitchen']) as string[],
      pendingJobs: pendingByPrinter.get(p.id) ?? 0,
    }));

  // スマホで読み取ってポーリングURLをコピーするためのQR（トークンは # 以降に置き、サーバーへ送らない）
  const setupQrById: Record<string, string> = {};
  if (siteUrl) {
    await Promise.all(
      cloudPrntRows
        .filter((p) => p.cloudprntEnabled && p.cloudprntToken)
        .map(async (p) => {
          // メーカーで接続方式が変わる（EPSON=Server Direct Print / Star=CloudPRNT）ため、案内画面にも渡す
          const query = /epson/i.test(p.maker) ? '?m=epson' : '';
          setupQrById[p.id] = await QRCode.toDataURL(`${siteUrl}/setup/printer${query}#${p.cloudprntToken}`, {
            width: 200,
            margin: 1,
          });
        })
    );
  }

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
  const kitchenTicket = kitchenTicketSettingsFrom(settingsRow?.settings ?? null);

  // ドリンク機があるのに、ドリンク商品のカテゴリが「ドリンク」に振り分けられていないと、その伝票はドリンク機に出ない
  const hasDrinkPrinter = cloudPrntRows.some(
    (p) => p.usage === 'kitchen' && p.cloudprntEnabled && p.kitchenStations.includes('drink')
  );
  let drinkCategoryWarnings: string[] = [];
  if (hasDrinkPrinter) {
    const [{ data: categoryRows }, { data: drinkItems }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, station')
        .eq('organization_id', ctx.organizationId)
        .or(`store_id.is.null,store_id.eq.${targetStore.id}`)
        .eq('status', 'active'),
      supabase
        .from('menu_items')
        .select('category_id')
        .eq('organization_id', ctx.organizationId)
        .or(`store_id.is.null,store_id.eq.${targetStore.id}`)
        .eq('status', 'active')
        .eq('item_type', 'drink'),
    ]);
    drinkCategoryWarnings = misroutedDrinkCategories(
      categoryRows ?? [],
      (drinkItems ?? []).map((i) => i.category_id)
    );
  }

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
    // 実機接続が有効かどうか（一覧のバッジとテスト印刷ボタンの出し分けに使う）
    cloudprntEnabled: p.cloudprnt_enabled ?? false,
    floorIds: normalizeFloorIds(p.floor_ids),
    billSlips: p.bill_slips ?? false,
    upsideDown: p.upside_down ?? false,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="レジ・プリンター" en="Registers & printers" description={targetStore.name} />

      <div className="grid gap-5 @5xl:grid-cols-3">
        {/* min-w-0: 中の表（横スクロール）が列幅を押し広げて画面からはみ出すのを防ぐ */}
        <div className="min-w-0 space-y-5 @5xl:col-span-1">
          {/* key: 店舗を切り替えたとき、前の店舗の入力値（useState）が残ったまま保存されないようにする
              （2026-09-26 店舗切替→保存で文字の大きさが別店舗の値で上書きされた） */}
          <RegistersPanel key={`reg-${targetStore.id}`} storeId={targetStore.id} initial={registerRows} />
          <DrawerPanel key={`drawer-${targetStore.id}`} storeId={targetStore.id} initial={drawerInitial} />
          <KitchenTicketPanel key={`kt-${targetStore.id}`} storeId={targetStore.id} initial={kitchenTicket} />
        </div>
        <div className="min-w-0 space-y-5 @5xl:col-span-2">
          {drinkCategoryWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">ドリンク機に出ないカテゴリがあります</p>
              <p className="mt-1 text-xs leading-relaxed">
                ドリンクの商品が入っているのに、厨房ステーションが「ドリンク」になっていません（この商品の伝票はキッチン機に出ます）：
                {drinkCategoryWarnings.slice(0, 12).join('、')}
                {drinkCategoryWarnings.length > 12 ? ` ほか${drinkCategoryWarnings.length - 12}件` : ''}
              </p>
              <Link href="/app/settings/menu" className="mt-1 inline-block text-xs font-semibold text-amber-900 underline">
                設定 → メニュー の「KDSステーション振り分け」で「ドリンク」にする
              </Link>
            </div>
          )}
          <Card>
            <CardContent>
              <PrintersPanel storeId={targetStore.id} initial={printerRows} floors={floors} />
            </CardContent>
          </Card>
          <CloudPrntPanel storeId={targetStore.id} siteUrl={siteUrl} printers={cloudPrntRows} setupQrById={setupQrById} />
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            レシート印字は上の「プリンター接続」で実機印字に対応します（Star mC-Print3 等の CloudPRNT 対応機、EPSON
            TM-m30III-H 等の Server Direct Print 対応機）。非対応機や未設定時は、レシート画面からのブラウザ印刷が利用できます。
          </div>
        </div>
      </div>
    </div>
  );
}
