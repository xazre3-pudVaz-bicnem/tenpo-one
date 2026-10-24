import 'server-only';
import { createHash } from 'node:crypto';
import type { createClient } from '@/lib/supabase/server';
import { kitchenTicketSettingsFrom } from '@/lib/kitchen-ticket';
import { dynamicPricingFrom } from '@/lib/dynamic-pricing';
import { parseLanTarget, bluetoothMakerOf } from '@/lib/direct-print';
import { normalizeFloorIds } from '@/lib/printer-floors';
import { devicePrinterId } from '@/lib/device-printer-server';
import type { NativeOfflineKit, OfflineKitItem, OfflinePrinter } from '@/lib/native-offline-kit';

type Client = Awaited<ReturnType<typeof createClient>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 中身のハッシュ（JSON を安定した並びで） */
function versionOf(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha1').update(JSON.stringify(stable(value))).digest('hex').slice(0, 16);
}

/**
 * レジの iPad がオフラインで使う道具箱（lib/native-offline-kit.ts の NativeOfflineKit）。
 * 店の名前・レシートの文言・サービス料・厨房伝票の設定・プリンター（LAN のアドレス）・商品の持ち場と税・卓のフロア・時間帯の値段。
 * サーバーの印字と同じ設定を読む（print-queue・print-actions・receipts-loader と同じ列）。
 */
export async function loadNativeOfflineKit(supabase: Client, storeId: string, organizationId: string): Promise<NativeOfflineKit> {
  const [{ data: store }, { data: ss }, { data: printers }, { data: categories }, { data: items }, { data: tables }, preferred] = await Promise.all([
    supabase.from('stores').select('id, name, address, phone').eq('id', storeId).maybeSingle(),
    supabase
      .from('store_settings')
      .select('settings, receipt_header, receipt_footer, invoice_registration_number, service_charge_rate')
      .eq('store_id', storeId)
      .maybeSingle(),
    supabase
      .from('printer_configs')
      .select('id, name, usage, maker, paper_width_mm, kitchen_stations, floor_ids, upside_down, bill_slips, auto_print, drawer_kick, drawer_command, ip_address, created_at')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .eq('cloudprnt_enabled', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('menu_categories')
      .select('id, station')
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .neq('status', 'deleted'),
    supabase
      .from('menu_items')
      .select('id, category_id, name_en, name_kana, item_type, price, tax_rates(rate, is_inclusive)')
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .in('status', ['active', 'hidden'])
      .neq('item_type', 'option'),
    supabase.from('restaurant_tables').select('id, floor_id').eq('store_id', storeId),
    devicePrinterId(),
  ]);

  const settings = (ss as { settings?: unknown } | null)?.settings ?? null;
  const categoryStations: Record<string, string> = {};
  for (const c of (categories ?? []) as { id: string; station: string | null }[]) categoryStations[c.id] = c.station ?? 'kitchen';

  const kitItems: Record<string, OfflineKitItem> = {};
  for (const m of (items ?? []) as unknown as {
    id: string;
    category_id: string | null;
    name_en: string | null;
    name_kana: string | null;
    item_type: string;
    price: number;
    tax_rates: { rate: number; is_inclusive: boolean } | { rate: number; is_inclusive: boolean }[] | null;
  }[]) {
    // 1対1の結合でも型は配列になることがある（insertOrderItem と同じく1件目）
    const tax = Array.isArray(m.tax_rates) ? (m.tax_rates[0] ?? null) : m.tax_rates;
    kitItems[m.id] = {
      categoryId: m.category_id,
      station: (m.category_id ? categoryStations[m.category_id] : undefined) ?? 'kitchen',
      nameEn: m.name_en,
      kana: m.name_kana,
      itemType: m.item_type,
      price: Number(m.price),
      taxRate: Number(tax?.rate ?? 10),
      taxIncluded: tax?.is_inclusive ?? true,
    };
  }

  const kitPrinters: OfflinePrinter[] = ((printers ?? []) as {
    id: string;
    name: string;
    usage: string;
    maker: string | null;
    paper_width_mm: number;
    kitchen_stations: string[] | null;
    floor_ids: string[] | null;
    upside_down: boolean | null;
    bill_slips: boolean | null;
    auto_print: boolean | null;
    drawer_kick: boolean | null;
    drawer_command: string | null;
    ip_address: string | null;
  }[]).map((p) => ({
    id: p.id,
    name: p.name,
    usage: p.usage,
    maker: bluetoothMakerOf(p.maker) === 'star' ? 'star' : 'escpos',
    paperWidth: p.paper_width_mm === 58 ? 58 : 80,
    stations: p.kitchen_stations ?? ['kitchen'],
    floorIds: normalizeFloorIds(p.floor_ids),
    upsideDown: p.upside_down === true,
    billSlips: p.bill_slips === true,
    autoPrint: p.auto_print === true,
    drawerKick: p.drawer_kick === true,
    drawerCommand: p.drawer_command ?? null,
    lan: parseLanTarget(p.ip_address),
  }));

  const tableFloors: Record<string, string | null> = {};
  for (const t of (tables ?? []) as { id: string; floor_id: string | null }[]) tableFloors[t.id] = t.floor_id;

  const floorBoard = (settings as { floorBoard?: { defaultFloorId?: unknown } } | null)?.floorBoard;
  const defaultFloorId = typeof floorBoard?.defaultFloorId === 'string' && UUID.test(floorBoard.defaultFloorId) ? floorBoard.defaultFloorId : null;
  const drawer = (settings as { drawer?: { autoOpenOnCash?: boolean; openOnCashless?: boolean } } | null)?.drawer;
  const row = ss as { receipt_header?: string | null; receipt_footer?: string | null; invoice_registration_number?: string | null; service_charge_rate?: number | null } | null;
  const s = store as { name?: string; address?: string | null; phone?: string | null } | null;

  const body: Omit<NativeOfflineKit, 'version'> = {
    storeId,
    store: {
      name: s?.name ?? '',
      address: s?.address ?? null,
      phone: s?.phone ?? null,
      registrationNumber: row?.invoice_registration_number ?? null,
      headerMessage: row?.receipt_header ?? null,
      footerMessage: row?.receipt_footer ?? null,
    },
    serviceChargeRate: Number(row?.service_charge_rate ?? 0) || 0,
    kitchen: { ...kitchenTicketSettingsFrom(settings), defaultFloorId },
    drawer: { autoOpenOnCash: drawer?.autoOpenOnCash ?? true, openOnCashless: drawer?.openOnCashless ?? false },
    printers: kitPrinters,
    preferredReceiptPrinterId: preferred,
    items: kitItems,
    categoryStations,
    tableFloors,
    dynamicRules: dynamicPricingFrom(settings).rules,
  };
  return { version: versionOf(body), ...body };
}
