'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { choiceToNativePos, deviceSettingsFrom, withDeviceSetting, type DeviceSetting } from '@/lib/device-settings';
import { keepNetworkPrinters } from '@/lib/network-printers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SaveDeviceSettingInput {
  storeId: string;
  deviceId: string;
  label: string;
  /** '' で「端末で選んだもの／店の既定」 */
  printerConfigId: string;
  nativePos: 'device' | 'on' | 'off';
}

/**
 * レジ端末（iPad）ごとの設定を管理画面から保存（2026-10-24 Ronnie「管理画面から全部の設定を」）。
 * store_settings.settings.devices[端末id] に書く（lib/device-settings.ts）。レジ（iPad）のアカウントからは変えられない。
 * LAN・Wi-Fi のプリンター（lanPrinterIds / wifiPrinterIds）は運営（コントロールセンター）が決める（2026-10-25 Ronnie）。
 * ここでは書かない（送られてきても無視して、今の値をそのまま残す。app/admin/organizations/printer-actions.ts）。
 */
export async function saveRegisterDeviceSetting(input: SaveDeviceSettingInput): Promise<{ ok: true; setting: DeviceSetting } | { ok: false; error: string }> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { ok: false, error: 'この設定は管理画面（パソコン）で変更してください' };
  if (!UUID.test(input.storeId) || !UUID.test(input.deviceId)) return { ok: false, error: '端末が見つかりません' };
  assertStoreAccess(ctx, input.storeId);

  const supabase = await createClient();
  const { data: device } = await supabase.from('register_devices').select('id, store_id, status').eq('id', input.deviceId).maybeSingle();
  if (!device || device.store_id !== input.storeId) return { ok: false, error: '端末が見つかりません' };

  let printerConfigId: string | null = null;
  if (input.printerConfigId) {
    if (!UUID.test(input.printerConfigId)) return { ok: false, error: 'プリンターが見つかりません' };
    const { data: printer } = await supabase
      .from('printer_configs')
      .select('id, store_id, usage, bill_slips, status')
      .eq('id', input.printerConfigId)
      .maybeSingle();
    if (!printer || printer.store_id !== input.storeId || printer.status !== 'active') return { ok: false, error: 'プリンターが見つかりません' };
    if (printer.usage !== 'receipt' && printer.bill_slips !== true) return { ok: false, error: 'レシートを出せるプリンターではありません（厨房用）' };
    printerConfigId = printer.id as string;
  }

  const { data: existing, error: readError } = await supabase.from('store_settings').select('settings').eq('store_id', input.storeId).maybeSingle();
  if (readError) return { ok: false, error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};

  // LAN・Wi-Fi は今の値のまま（運営が決める）
  const setting: DeviceSetting = keepNetworkPrinters(
    {
      label: input.label.trim().slice(0, 40) || null,
      printerConfigId,
      nativePos: choiceToNativePos(input.nativePos),
    },
    deviceSettingsFrom(current)[input.deviceId]
  );

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      settings: withDeviceSetting(current, input.deviceId, setting),
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { ok: false, error: `保存に失敗しました: ${error.message}` };
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.register_device.update',
    p_target_table: 'register_devices',
    p_target_id: input.deviceId,
    p_before: null,
    p_after: { label: setting.label, printerConfigId: setting.printerConfigId, nativePos: setting.nativePos },
    p_note: null,
  });
  revalidatePath('/app/settings/devices');
  revalidatePath('/app/pos/settings');
  return { ok: true, setting };
}
