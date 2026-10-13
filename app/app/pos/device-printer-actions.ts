'use server';

import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DEVICE_PRINTER_COOKIE } from '@/lib/direct-print';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * この端末（iPad）のレシートプリンターを選ぶ（Airレジのように端末ごと。2026-10-13 Ronnie「プリンターを選べるように」）。
 * 店の設定は変えない（この端末の cookie だけ）。null で「おまかせ（店の既定）」に戻す。
 * 選べるのは、この人の店舗のレシート機と「会計伝票も出す」プリンターだけ。
 */
export async function setDevicePrinter(printerId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  const jar = await cookies();
  if (!printerId) {
    jar.delete(DEVICE_PRINTER_COOKIE);
    return { ok: true };
  }
  if (!UUID.test(printerId)) return { ok: false, error: 'プリンターが見つかりません' };

  const supabase = await createClient();
  const { data: printer } = await supabase
    .from('printer_configs')
    .select('id, store_id, usage, bill_slips, status')
    .eq('id', printerId)
    .maybeSingle();
  const inMyStore = printer && (ctx.isHq || ctx.stores.some((s) => s.id === printer.store_id));
  if (!printer || !inMyStore || printer.status !== 'active') return { ok: false, error: 'プリンターが見つかりません' };
  if (printer.usage !== 'receipt' && printer.bill_slips !== true) {
    return { ok: false, error: 'レシートを出せるプリンターではありません（厨房用）' };
  }
  jar.set(DEVICE_PRINTER_COOKIE, printer.id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
}
