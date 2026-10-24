import 'server-only';
import { cookies } from 'next/headers';
import { DEVICE_PRINTER_COOKIE } from '@/lib/direct-print';
import { currentDeviceSetting } from '@/lib/register-device-server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * この端末（ブラウザ）で選んだレシートプリンター（レジの設定「このiPadのプリンター」。cookie）。
 * 選んでいなければ null（今まで通り、店の既定のプリンター・フロアのプリンター）。
 */
export async function cookieDevicePrinterId(): Promise<string | null> {
  try {
    const v = (await cookies()).get(DEVICE_PRINTER_COOKIE)?.value ?? null;
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * この端末のレシートの出し先。管理画面で付けた設定（設定 › レジ端末）があればそれが先、無ければ端末で選んだもの（cookie）。
 * （2026-10-24 Ronnie「管理画面から全部の設定を」）
 */
export async function devicePrinterId(): Promise<string | null> {
  const admin = await currentDeviceSetting();
  if (admin?.setting.printerConfigId) return admin.setting.printerConfigId;
  return cookieDevicePrinterId();
}
