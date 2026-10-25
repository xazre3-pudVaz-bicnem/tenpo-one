'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { deviceSettingsFrom, withDeviceSetting } from '@/lib/device-settings';
import { normalizeFloorIds } from '@/lib/printer-floors';
import {
  isManagedNetworkPrinter,
  keepKnownPrinterIds,
  networkPrinterCandidates,
  NETWORK_CONNECTIONS,
  parseDeviceNetworkPrintersInput,
  parseNetworkPrinterInput,
  parseNetworkPrinterRef,
  printerConfigColumns,
  withNetworkPrinters,
  withoutNetworkPrinter,
  type NetworkPrinterRow,
} from '@/lib/network-printers';

/**
 * 運営コンソール（コントロールセンター）：店舗の LAN・Wi-Fi のプリンターと、iPad ごとの割り当て
 * （2026-10-25 Ronnie「printer の LAN・Wi-Fi の設定は 店舗管理画面 からではなく control centre から」）。
 *   - プリンター … printer_configs（connection_type = lan / wifi）の追加・編集・削除（論理削除）
 *   - iPad ごと … store_settings.settings.devices[register_devices.id].lanPrinterIds / wifiPrinterIds（lib/device-settings.ts）
 * どれも最初に requireCypressAdmin（運営だけ。ちがえば /app/dashboard へ）。画面から来た企業・店舗・端末・プリンターは、
 * サービスロールで DB を読んで「その企業のその店舗のもの」か確かめてから書く。お店の管理画面からは見るだけ（lib/network-printers.ts）。
 */

export interface AdminPrinterResult {
  error?: string;
}

/** 保存できたら、実際に保存した値（候補でない id を捨てたあと） */
export interface AdminDeviceNetworkPrintersResult extends AdminPrinterResult {
  lanPrinterIds?: string[] | null;
  wifiPrinterIds?: string[] | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** この店舗がこの企業のものか（店舗の行） */
async function storeOfOrg(admin: Admin, organizationId: string, storeId: string): Promise<boolean> {
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', storeId).maybeSingle();
  return !!store && store.organization_id === organizationId;
}

async function audit(organizationId: string, storeId: string, action: string, targetTable: string, targetId: string, after: unknown) {
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: storeId,
    p_action: action,
    p_target_table: targetTable,
    p_target_id: targetId,
    p_before: null,
    p_after: after as never,
    p_note: null,
  });
}

function revalidate(organizationId: string) {
  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath('/app/settings/printers');
  revalidatePath('/app/settings/devices');
}

/** LAN・Wi-Fi のプリンターを追加・編集する（運営だけ） */
export async function saveAdminNetworkPrinter(raw: unknown): Promise<AdminPrinterResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parseNetworkPrinterInput(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  if (!(await storeOfOrg(admin, input.organizationId, input.storeId))) return { error: '店舗が見つかりません' };

  if (input.id) {
    const { data: current } = await admin
      .from('printer_configs')
      .select('id, organization_id, store_id, status, connection_type')
      .eq('id', input.id)
      .maybeSingle();
    if (!isManagedNetworkPrinter(current, input)) return { error: 'プリンターが見つかりません' };
  }

  // 担当フロアはこの店舗のフロアだけ（他店舗の ID や削除済みは捨てる）
  let floorIds: string[] = [];
  if (input.floorIds.length > 0) {
    const { data: floors } = await admin.from('floors').select('id').eq('store_id', input.storeId).eq('status', 'active');
    floorIds = normalizeFloorIds(input.floorIds, new Set((floors ?? []).map((f) => f.id as string)));
  }

  const payload = {
    ...printerConfigColumns(input, floorIds),
    cloudprnt_enabled: input.enabled,
    updated_by: ctx.userId,
  };
  let printerId = input.id;
  if (input.id) {
    const { error } = await admin
      .from('printer_configs')
      .update(payload)
      .eq('id', input.id)
      .eq('organization_id', input.organizationId)
      .eq('store_id', input.storeId);
    if (error) return { error: `プリンターの更新に失敗しました: ${error.message}` };
  } else {
    const { data, error } = await admin
      .from('printer_configs')
      .insert({ ...payload, organization_id: input.organizationId, store_id: input.storeId, created_by: ctx.userId })
      .select('id')
      .single();
    if (error || !data) return { error: `プリンターの追加に失敗しました: ${error?.message ?? '不明なエラー'}` };
    printerId = data.id as string;
  }

  await audit(input.organizationId, input.storeId, input.id ? 'admin.network_printer.update' : 'admin.network_printer.add', 'printer_configs', printerId ?? input.storeId, {
    name: payload.name,
    usage: payload.usage,
    connection_type: payload.connection_type,
    ip_address: payload.ip_address,
    enabled: input.enabled,
  });
  revalidate(input.organizationId);
  return {};
}

/** LAN・Wi-Fi のプリンターを削除する（論理削除・運営だけ）。iPad ごとの LAN・Wi-Fi の一覧からも外す */
export async function deleteAdminNetworkPrinter(raw: unknown): Promise<AdminPrinterResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parseNetworkPrinterRef(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  if (!(await storeOfOrg(admin, input.organizationId, input.storeId))) return { error: '店舗が見つかりません' };

  const { data: current } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, status, connection_type, name')
    .eq('id', input.printerId)
    .maybeSingle();
  if (!isManagedNetworkPrinter(current, input)) return { error: 'プリンターが見つかりません' };

  const { error } = await admin
    .from('printer_configs')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', input.printerId)
    .eq('organization_id', input.organizationId)
    .eq('store_id', input.storeId);
  if (error) return { error: `プリンターの削除に失敗しました: ${error.message}` };

  // 消したプリンターを、どの iPad の「LAN で送る」「Wi-Fi で直接印刷」からも外す（ほかの設定はそのまま）
  const { data: settingsRow } = await admin.from('store_settings').select('settings').eq('store_id', input.storeId).maybeSingle();
  const cleaned = withoutNetworkPrinter((settingsRow?.settings as Record<string, unknown> | null) ?? {}, input.printerId);
  if (cleaned.changed) {
    const { error: settingsError } = await admin
      .from('store_settings')
      .update({ settings: cleaned.settings, updated_by: ctx.userId })
      .eq('store_id', input.storeId);
    if (settingsError) return { error: `プリンターは削除しましたが、iPad の設定から外せませんでした: ${settingsError.message}` };
  }

  await audit(input.organizationId, input.storeId, 'admin.network_printer.delete', 'printer_configs', input.printerId, {
    name: current?.name ?? null,
    status: 'deleted',
  });
  revalidate(input.organizationId);
  return {};
}

/**
 * iPad ごとに、LAN で送るプリンター・Wi-Fi で直接印刷するプリンターを決める（運営だけ）。
 * null は端末まかせ（今までどおり）、[] は送らない。選べるのはこの店の候補だけ（lib/network-printers.ts の networkPrinterCandidates）。
 * 表示名・レシートの出し先など、ほかの設定はそのまま（お店の管理画面の 設定 › レジ端末 で決める）。
 */
export async function saveAdminDeviceNetworkPrinters(raw: unknown): Promise<AdminDeviceNetworkPrintersResult> {
  const ctx = await requireCypressAdmin();
  const parsed = parseDeviceNetworkPrintersInput(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const admin = createAdminClient();
  if (!(await storeOfOrg(admin, input.organizationId, input.storeId))) return { error: '店舗が見つかりません' };

  const { data: device } = await admin.from('register_devices').select('id, organization_id, store_id, status').eq('id', input.deviceId).maybeSingle();
  if (!device || device.organization_id !== input.organizationId || device.store_id !== input.storeId) return { error: '端末が見つかりません' };
  if (device.status !== 'active') return { error: '登録を解除した端末です' };

  // この店の、使っている LAN・Wi-Fi のプリンターから候補を作る（他店舗・削除済み・候補でない id は捨てる）
  const { data: printerRows, error: printersError } = await admin
    .from('printer_configs')
    .select('id, name, maker, usage, connection_type, ip_address, cloudprnt_enabled')
    .eq('organization_id', input.organizationId)
    .eq('store_id', input.storeId)
    .eq('status', 'active')
    .in('connection_type', [...NETWORK_CONNECTIONS]);
  if (printersError) return { error: `プリンターの読み込みに失敗しました: ${printersError.message}` };
  const { lan, wifi } = networkPrinterCandidates((printerRows ?? []) as NetworkPrinterRow[]);
  const lanPrinterIds = keepKnownPrinterIds(input.lanPrinterIds, new Set(lan.map((p) => p.id)));
  const wifiPrinterIds = keepKnownPrinterIds(input.wifiPrinterIds, new Set(wifi.map((p) => p.id)));

  const { data: existing, error: readError } = await admin.from('store_settings').select('settings').eq('store_id', input.storeId).maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const setting = withNetworkPrinters(deviceSettingsFrom(current)[input.deviceId], lanPrinterIds, wifiPrinterIds);
  const { error } = await admin.from('store_settings').upsert(
    {
      organization_id: input.organizationId,
      store_id: input.storeId,
      settings: withDeviceSetting(current, input.deviceId, setting),
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };

  await audit(input.organizationId, input.storeId, 'admin.register_device.network_printers', 'register_devices', input.deviceId, {
    lanPrinterIds,
    wifiPrinterIds,
  });
  revalidate(input.organizationId);
  revalidatePath('/app/pos/settings');
  return { lanPrinterIds, wifiPrinterIds };
}
