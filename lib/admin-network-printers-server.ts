import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { deviceKind, deviceSettingsFrom, deviceDisplayName, EMPTY_DEVICE_SETTING } from '@/lib/device-settings';
import { normalizeFloorIds } from '@/lib/printer-floors';
import { networkPrinterCandidates, NETWORK_CONNECTIONS, type NetworkPrinterOption, type NetworkPrinterRow } from '@/lib/network-printers';
import type { FloorOption, PrinterConfigRow } from '@/components/settings/printer-dialog';

/** 運営コンソールの「プリンター（LAN・Wi-Fi）」に出す iPad 1 台 */
export interface AdminRegisterDevice {
  id: string;
  name: string;
  kind: string;
  lastSeenAt: string | null;
  status: 'active' | 'revoked';
  lanPrinterIds: string[] | null;
  wifiPrinterIds: string[] | null;
}

/** 店舗 1 つぶん */
export interface AdminStoreNetworkPrinters {
  storeId: string;
  storeName: string;
  /** この店の LAN・Wi-Fi のプリンター（使っているもの） */
  printers: PrinterConfigRow[];
  floors: FloorOption[];
  devices: AdminRegisterDevice[];
  /** iPad ごとに選べるもの（lib/network-printers.ts の networkPrinterCandidates） */
  lanOptions: NetworkPrinterOption[];
  wifiOptions: NetworkPrinterOption[];
}

/**
 * 運営コンソール（/admin/organizations/[id]）：企業の店舗ごとの LAN・Wi-Fi のプリンターと、iPad ごとの割り当て
 * （2026-10-25 Ronnie「printer の LAN・Wi-Fi は control centre から」）。サービスロールで読む（呼ぶ側で requireCypressAdmin 済み）。
 */
export async function loadOrgNetworkPrinters(organizationId: string, stores: { id: string; name: string }[]): Promise<AdminStoreNetworkPrinters[]> {
  if (stores.length === 0) return [];
  const storeIds = stores.map((s) => s.id);
  const admin = createAdminClient();
  const [printersRes, floorsRes, devicesRes, settingsRes] = await Promise.all([
    admin
      .from('printer_configs')
      .select(
        'id, store_id, name, maker, model, connection_type, ip_address, usage, paper_width_mm, auto_print, drawer_kick, is_verified, cloudprnt_enabled, floor_ids, bill_slips, upside_down'
      )
      .eq('organization_id', organizationId)
      .in('store_id', storeIds)
      .eq('status', 'active')
      .in('connection_type', [...NETWORK_CONNECTIONS])
      .order('name'),
    admin.from('floors').select('id, store_id, name').eq('organization_id', organizationId).in('store_id', storeIds).eq('status', 'active').order('sort_order').order('name'),
    admin
      .from('register_devices')
      .select('id, store_id, name, user_agent, last_seen_at, status')
      .eq('organization_id', organizationId)
      .in('store_id', storeIds)
      .order('status')
      .order('created_at'),
    admin.from('store_settings').select('store_id, settings').in('store_id', storeIds),
  ]);
  for (const res of [printersRes, floorsRes, devicesRes, settingsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const settingsByStore = new Map<string, unknown>((settingsRes.data ?? []).map((r) => [r.store_id as string, r.settings]));
  return stores.map((store) => {
    const printerRows = (printersRes.data ?? []).filter((p) => p.store_id === store.id);
    const printers: PrinterConfigRow[] = printerRows.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      maker: (p.maker as string | null) ?? '',
      model: (p.model as string | null) ?? '',
      connectionType: p.connection_type as string,
      ipAddress: (p.ip_address as string | null) ?? '',
      usage: p.usage as string,
      paperWidthMm: p.paper_width_mm as number,
      autoPrint: p.auto_print === true,
      drawerKick: p.drawer_kick === true,
      isVerified: p.is_verified === true,
      cloudprntEnabled: p.cloudprnt_enabled === true,
      floorIds: normalizeFloorIds(p.floor_ids),
      billSlips: p.bill_slips === true,
      upsideDown: p.upside_down === true,
    }));
    const { lan, wifi } = networkPrinterCandidates(printerRows as NetworkPrinterRow[]);
    const settings = deviceSettingsFrom(settingsByStore.get(store.id) ?? null);
    const devices: AdminRegisterDevice[] = (devicesRes.data ?? [])
      .filter((d) => d.store_id === store.id)
      .map((d) => {
        const setting = settings[d.id as string] ?? EMPTY_DEVICE_SETTING;
        return {
          id: d.id as string,
          name: deviceDisplayName({ name: (d.name as string | null) ?? null }, setting),
          kind: deviceKind(d.user_agent as string | null),
          lastSeenAt: (d.last_seen_at as string | null) ?? null,
          status: d.status === 'revoked' ? 'revoked' : 'active',
          lanPrinterIds: setting.lanPrinterIds,
          wifiPrinterIds: setting.wifiPrinterIds,
        };
      });
    return {
      storeId: store.id,
      storeName: store.name,
      printers,
      floors: (floorsRes.data ?? []).filter((f) => f.store_id === store.id).map((f) => ({ id: f.id as string, name: f.name as string })),
      devices,
      lanOptions: lan,
      wifiOptions: wifi,
    };
  });
}
