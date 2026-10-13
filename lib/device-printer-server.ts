import 'server-only';
import { cookies } from 'next/headers';
import { DEVICE_PRINTER_COOKIE } from '@/lib/direct-print';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * この端末（ブラウザ）で選んだレシートプリンター（レジの設定「このiPadのプリンター」。cookie）。
 * 選んでいなければ null（今まで通り、店の既定のプリンター・フロアのプリンター）。
 */
export async function devicePrinterId(): Promise<string | null> {
  try {
    const v = (await cookies()).get(DEVICE_PRINTER_COOKIE)?.value ?? null;
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}
