import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { REGISTER_COOKIE } from '@/lib/store-access';
import { hashDeviceToken } from '@/lib/store-access-server';
import { deviceSettingsFrom, EMPTY_DEVICE_SETTING, type DeviceSetting } from '@/lib/device-settings';

export interface CurrentRegisterDevice {
  id: string;
  storeId: string;
  organizationId: string;
  name: string;
}

/**
 * この端末（レジの Cookie のトークン）が register_devices のどの行か。レジとして登録していなければ null。
 * 同じリクエストの中では 1 回しか引かない（React cache）。
 */
export const currentRegisterDevice = cache(async (): Promise<CurrentRegisterDevice | null> => {
  try {
    const token = (await cookies()).get(REGISTER_COOKIE)?.value ?? null;
    if (!token) return null;
    const admin = createAdminClient();
    const { data } = await admin
      .from('register_devices')
      .select('id, store_id, organization_id, name, status')
      .eq('token_hash', hashDeviceToken(token))
      .maybeSingle();
    if (!data || data.status !== 'active') return null;
    return { id: data.id as string, storeId: data.store_id as string, organizationId: data.organization_id as string, name: (data.name as string) ?? 'レジ端末' };
  } catch {
    return null;
  }
});

/**
 * この端末に管理画面で付けた設定（store_settings.settings.devices[端末id]）。登録していない・設定が無ければ空の設定。
 * （2026-10-24 Ronnie「管理画面から全部の設定を」。lib/device-settings.ts）
 */
export const currentDeviceSetting = cache(async (): Promise<{ device: CurrentRegisterDevice; setting: DeviceSetting } | null> => {
  const device = await currentRegisterDevice();
  if (!device) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('store_settings').select('settings').eq('store_id', device.storeId).maybeSingle();
    const setting = deviceSettingsFrom(data?.settings ?? null)[device.id] ?? EMPTY_DEVICE_SETTING;
    return { device, setting };
  } catch {
    return { device, setting: EMPTY_DEVICE_SETTING };
  }
});
