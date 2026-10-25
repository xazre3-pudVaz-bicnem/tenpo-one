import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Lock } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { kitchenTicketSettingsFrom } from '@/lib/kitchen-ticket';
import { registerBackUrl, registerOrderId, registerSettingSections } from '@/lib/register-settings';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { KitchenTicketPanel } from '@/components/settings/kitchen-ticket-panel';
import { VisitSourcesPanel } from '@/components/settings/visit-sources-panel';
import { visitSourcesFrom } from '@/lib/handy-visit';
import { RegisterSettingsList } from '@/components/pos/register-settings-list';
import { SettingsSubTabs } from '@/components/settings/settings-nav';
import { settingsHubOf, settingsHubs } from '@/lib/settings-hubs';
import { isDisplayMonitorOnForSettings } from '@/lib/display-monitor-server';
import { DevicePrinterPanel, type DevicePrinterOption } from '@/components/pos/device-printer-panel';
import { NativePosToggle } from '@/components/pos/native-pos-toggle';
import { devicePrinterId } from '@/lib/device-printer-server';
import { currentDeviceSetting } from '@/lib/register-device-server';

export const metadata: Metadata = { title: 'レジの設定' };

const SELF_HREF = '/app/pos/settings';

/**
 * レジの設定（POSレジ・注文画面・フロア・左メニューの「レジの設定」から開く）。
 * 2026-09-21 店舗要望「レジから今までのことを変えられるように」:
 *   厨房伝票（分け方・商品名の言語）はこの画面でその場で変える。文字の大きさはパソコンの管理画面だけ（2026-09-26）。
 *   メニュー（品切れ・商品の編集・並び順・カテゴリの出し方・ページ・プラン・ランチ・選択肢）、
 *   キッチンの振り分け・プリンター、テーブルQRの印刷、ハンディ・担当者、予約・営業時間は、ボタンで各画面を開く
 *   （開いた画面の上の「レジの設定に戻る」でここに戻る）。
 */
export default async function RegisterSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  const orderId = registerOrderId(order);
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <div>
        <PageHeader title="レジの設定" en="Register settings" />
        <EmptyState
          title={store ? 'レジを使う権限がありません' : '対象の店舗がありません'}
          description={store ? '店長・管理者に権限の付与を依頼してください' : '店舗を選択してから設定を行ってください'}
        />
      </div>
    );
  }

  // 厨房伝票（分け方・言語）と来店経路は管理画面だけ。レジ（iPad）には出さない（2026-09-29 Ronnie「管理画面だけ」）
  const adminOnly = ctx.isRegisterDevice === true;
  const canKitchen = can(ctx.role, 'store.settings') && !adminOnly;
  let kitchen = null;
  let visitSourceIds: string[] = [];
  if (canKitchen) {
    const supabase = await createClient();
    const { data } = await supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
    kitchen = kitchenTicketSettingsFrom(data?.settings ?? null);
    visitSourceIds = visitSourcesFrom(data?.settings ?? null).map((s) => s.id);
  }

  // このiPadのプリンター（端末ごとに選ぶ・EPSON は Wi-Fi で直接印刷。2026-10-13 Ronnie「Airレジのように」）
  const supabaseForPrinters = await createClient();
  const { data: printerRows } = await supabaseForPrinters
    .from('printer_configs')
    .select('id, name, maker, model, usage, bill_slips, ip_address, connection_type, cloudprnt_enabled, paper_width_mm, auto_print, drawer_kick')
    .eq('store_id', store.id)
    .eq('status', 'active')
    // 印刷を受けるプリンター＋管理画面で Bluetooth・USB として足しただけのもの（iPad でつなぐと使えるようになる）
    .or('cloudprnt_enabled.eq.true,connection_type.in.(bluetooth,usb)')
    .order('name');
  const devicePrinters: DevicePrinterOption[] = (printerRows ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    maker: (p.maker as string | null) ?? null,
    usage: (p.usage as string) ?? 'receipt',
    billSlips: p.bill_slips === true,
    ip: ((p.ip_address as string | null) ?? '').trim() || null,
    enabled: p.cloudprnt_enabled === true,
    connection: (p.connection_type as string | null) ?? null,
    model: (p.model as string | null) ?? null,
    paperWidthMm: p.paper_width_mm === 58 ? 58 : 80,
    autoPrint: p.auto_print === true,
    drawerKick: p.drawer_kick === true,
  }));
  const selectedPrinterId = await devicePrinterId();
  // 管理画面（設定 › レジ端末）でこの iPad のプリンターを決めてあれば、それが先（2026-10-24 Ronnie「管理画面から全部の設定を」）
  const adminDevice = await currentDeviceSetting();
  const adminPrinterName = adminDevice?.setting.printerConfigId ? (devicePrinters.find((p) => p.id === adminDevice.setting.printerConfigId)?.name ?? null) : null;

  // 設定の中と同じ上のタブ（レジの設定／ハードウェア／iPhoneハンディ…）。2026-09-29 Ronnie「設定の中は全部このタブを」
  // ディスプレイ端末のタブは運営が企業・店舗の両方で ON にしたときだけ
  const hub = settingsHubOf(settingsHubs({ ...ctx, displayMonitorOn: await isDisplayMonitorOnForSettings(ctx) }), SELF_HREF);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={registerBackUrl(orderId)}
        className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {orderId ? '伝票に戻る' : 'POSレジへ戻る'}
      </Link>
      {hub && (hub.children?.length ?? 0) > 1 && <SettingsSubTabs item={hub} pathname={SELF_HREF} activeHref={SELF_HREF} />}
      <PageHeader
        title="レジの設定"
        en="Register settings"
        description={`${store.name}｜レジから変えられる設定をまとめています。保存すると、次の注文からレジ・ハンディ・お客様QR・プリンターに反映されます`}
      />

      {adminOnly ? (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          <Lock className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
          <span>
            厨房伝票（分け方・言語）と来店経路は管理画面（パソコン）で変更します
            <span className="block text-xs text-gray-400">Kitchen tickets and visit sources are changed from the admin screen</span>
          </span>
        </div>
      ) : (
      <section aria-labelledby="register-settings-kitchen-ticket" className="mb-6">
        <h2 id="register-settings-kitchen-ticket" className="mb-2 text-sm font-bold text-navy">
          厨房伝票（キッチン・ドリンクのプリンター）
          <span className="ml-1.5 text-xs font-normal text-gray-400">Kitchen tickets</span>
        </h2>
        {kitchen ? (
          // 文字の大きさはパソコンの管理画面（設定 > レジ・プリンター）だけ（2026-09-26 Ronnie）
          <KitchenTicketPanel key={store.id} storeId={store.id} initial={kitchen} showTextSize={false} />
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <Lock className="h-4 w-4 text-gray-300" aria-hidden />
            分け方・商品名の言語は、店長以上が変更できます
          </div>
        )}
      </section>
      )}

      {/* 来店経路（お客様情報のボタン）。使わないサイトは外せる（2026-09-24 店舗要望） */}
      {kitchen && (
        <section aria-labelledby="register-settings-visit-sources" className="mb-6">
          <h2 id="register-settings-visit-sources" className="mb-2 text-sm font-bold text-navy">
            来店経路（お客様情報のボタン）
            <span className="ml-1.5 text-xs font-normal text-gray-400">Visit sources</span>
          </h2>
          <VisitSourcesPanel storeId={store.id} initial={visitSourceIds} />
        </section>
      )}

      <section aria-labelledby="register-settings-device-printer" className="mb-6">
        <h2 id="register-settings-device-printer" className="mb-2 text-sm font-bold text-navy">
          このiPadのプリンター
          <span className="ml-1.5 text-xs font-normal text-gray-400">This iPad&apos;s printer</span>
        </h2>
        {adminPrinterName && (
          <p className="mb-2 rounded-xl border border-iris-soft bg-iris-soft px-4 py-2 text-[13px] text-royal">
            管理画面の「設定 › レジ端末」で、この iPad のレシートは <b>{adminPrinterName}</b> に決めてあります（ここで選んでもそちらが優先）
          </p>
        )}
        <DevicePrinterPanel
          printers={devicePrinters}
          selectedId={devicePrinters.some((p) => p.id === selectedPrinterId) ? selectedPrinterId : null}
          canAdd={can(ctx.role, 'store.settings')}
        />
      </section>

      {/* アプリの中だけ出る（ブラウザでは何も出ない） */}
      <NativePosToggle />

      <RegisterSettingsList sections={registerSettingSections(ctx.role, orderId, { isRegisterDevice: ctx.isRegisterDevice === true })} />
    </div>
  );
}
