import 'server-only';
import type { SessionContext } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { bluetoothMakerOf, isEpsonMaker, isLanRelayPrinter, isLocalPrinterHost, parseLanTarget, printerDeliveryOf } from '@/lib/direct-print';
import { PRINTER_MAKER_LABEL, PRINTER_MODELS } from '@/lib/printer-models';
import { permissionHint, registerSettingSections } from '@/lib/register-settings';
import { settingsHubs } from '@/lib/settings-hubs';
import { loadDisplayMonitorFlag } from '@/lib/display-monitor-server';
import { devicePrinterId } from '@/lib/device-printer-server';
import type { NativeSettingsPayload, NativeSettingsPrinter } from '@/lib/native-settings';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', label: 'ラベル' };

/**
 * ネイティブの設定画面の読み込み（Web の /app/pos/settings と同じ組み立て。2026-10-24 Ronnie「iOS プリンター＋設定」）。
 *   プリンター：印刷を受けるもの＋管理画面で Bluetooth・USB として足しただけのもの（iPad でつなぐと使えるようになる）
 *   レシートの出し先：この端末の cookie（lib/device-printer-server.ts）
 *   設定の一覧：レジから変えられる設定（lib/register-settings.ts）と、管理画面の設定のまとめ（lib/settings-hubs.ts）
 */
export async function loadNativeSettings(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeSettingsPayload> {
  const [{ data: rows }, selected] = await Promise.all([
    supabase
      .from('printer_configs')
      .select('id, name, maker, model, usage, bill_slips, ip_address, connection_type, cloudprnt_enabled, paper_width_mm, auto_print, drawer_kick')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .or('cloudprnt_enabled.eq.true,connection_type.in.(bluetooth,usb)')
      .order('name'),
    devicePrinterId(),
  ]);

  const printers: NativeSettingsPrinter[] = (rows ?? []).map((p) => {
    const maker = (p.maker as string | null) ?? null;
    const connection = (p.connection_type as string | null) ?? null;
    const ip = ((p.ip_address as string | null) ?? '').trim() || null;
    const target = parseLanTarget(ip);
    const enabled = p.cloudprnt_enabled === true;
    const deviceLink = connection === 'bluetooth' || connection === 'usb';
    const usage = (p.usage as string) ?? 'receipt';
    return {
      id: p.id as string,
      name: p.name as string,
      maker,
      btMaker: bluetoothMakerOf(maker),
      model: (p.model as string | null) ?? null,
      usage,
      usageLabel: USAGE_LABEL[usage] ?? usage,
      billSlips: p.bill_slips === true,
      ip,
      lanHost: target?.host ?? null,
      lanPort: target?.port ?? null,
      enabled,
      connection,
      delivery: printerDeliveryOf({ maker, connection }),
      paperWidthMm: p.paper_width_mm === 58 ? 58 : 80,
      autoPrint: p.auto_print === true,
      drawerKick: p.drawer_kick === true,
      lanRelay: enabled && (connection === 'lan' || connection === 'wifi') && isLanRelayPrinter({ maker, connection, ip }),
      wifiDirect: enabled && isEpsonMaker(maker) && !deviceLink && isLocalPrinterHost(ip),
      deviceLink,
    };
  });

  const isRegisterDevice = ctx.isRegisterDevice === true;
  const sections = registerSettingSections(ctx.role, null, { isRegisterDevice }).map((s) => ({
    id: s.id,
    title: s.title,
    en: s.en,
    links: s.links.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      url: l.url,
      allowed: l.allowed,
      hint: l.allowed ? null : permissionHint(l.permission),
    })),
  }));
  // ディスプレイ端末は運営が企業・店舗の両方で ON にしたときだけ デバイス管理 に出す
  const displayMonitorOn = ctx.organizationId ? (await loadDisplayMonitorFlag(ctx.organizationId, store.id)).on : false;
  const hubs = ctx.role
    ? settingsHubs({ role: ctx.role, disabledFeatures: ctx.disabledFeatures, isRegisterDevice, displayMonitorOn })
        .filter((h) => (h.children?.length ?? 0) > 0)
        .map((h) => ({
          label: h.label,
          en: h.en,
          href: h.href,
          children: (h.children ?? []).map((c) => ({ href: c.href, label: c.label, en: c.en, description: c.description })),
        }))
    : [];

  return {
    store,
    userName: ctx.displayName,
    isRegisterDevice,
    canAdd: can(ctx.role, 'store.settings'),
    printers,
    selectedPrinterId: printers.some((p) => p.id === selected) ? selected : null,
    models: PRINTER_MODELS.map((m) => ({
      id: m.id,
      maker: m.maker,
      makerLabel: PRINTER_MAKER_LABEL[m.maker],
      name: m.name,
      paper: m.paper,
      drawer: m.drawer,
      mobile: m.mobile === true,
      ready: m.ready,
    })),
    sections,
    hubs,
  };
}
