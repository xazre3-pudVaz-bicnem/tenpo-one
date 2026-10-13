'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import {
  BT_MAKERS,
  BT_MAKER_SETTING,
  DEVICE_PRINTER_COOKIE,
  bluetoothMakerOf,
  deviceReceiptPrinterName,
  type BtMaker,
} from '@/lib/direct-print';

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

export interface AddedDevicePrinter {
  id: string;
  name: string;
  maker: string;
  usage: 'receipt';
  billSlips: false;
  ip: null;
  enabled: true;
  connection: 'bluetooth' | 'usb';
}

/**
 * iPad（TENPO ONE レジ アプリ）でつないだ Bluetooth・USB のレシートプリンター（＋ドロア）を、その場で店のプリンターにする。
 * 2026-10-13 Ronnie「iPad アプリでプリンターの設定。レシートは Bluetooth から」（Airレジのように iPad だけで済む。パソコン不要）。
 *   - printerId なし：この店のレシートプリンターとして追加（同じ名前・つなぎ方の行があればそれを使う。二重に作らない）
 *   - printerId あり：管理画面で Bluetooth・USB として追加済みの行を、印刷を受けられる状態にする
 *   どちらも、このiPadのレシートの出し先にする（cookie）。
 * 店長以上（設定 > レジ・プリンター と同じ権限）。厨房・ドリンクのプリンター、Wi-Fi・LAN はここでは触らない（管理画面だけ）。
 */
export async function addDeviceReceiptPrinter(input: {
  printerId?: string | null;
  name?: string | null;
  maker: string;
  via: string;
}): Promise<{ ok: true; printer: AddedDevicePrinter } | { ok: false; error: string }> {
  const ctx = await requireSession();
  if (!ctx.organizationId) return { ok: false, error: 'ログインしてください' };
  if (!can(ctx.role, 'store.settings')) return { ok: false, error: 'プリンターの追加は店長以上のアカウントでできます' };
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { ok: false, error: '店舗を選んでください' };
  if (!BT_MAKERS.includes(input.maker as BtMaker)) return { ok: false, error: 'プリンターの種類が分かりません' };
  const maker = input.maker as BtMaker;
  const via: 'bluetooth' | 'usb' = input.via === 'usb' ? 'usb' : 'bluetooth';

  const supabase = await createClient();
  let row: { id: string; name: string; maker: string | null; storeId: string } | null = null;
  let action: 'config_add' | 'config_update' = 'config_add';

  if (input.printerId) {
    if (!UUID.test(input.printerId)) return { ok: false, error: 'プリンターが見つかりません' };
    const { data: existing } = await supabase
      .from('printer_configs')
      .select('id, name, maker, store_id, usage, connection_type, status')
      .eq('id', input.printerId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    const inMyStore = existing && (ctx.isHq || ctx.stores.some((s) => s.id === existing.store_id));
    if (!existing || !inMyStore || existing.status !== 'active') return { ok: false, error: 'プリンターが見つかりません' };
    if (existing.usage !== 'receipt') return { ok: false, error: 'レシートのプリンターではありません（厨房用は管理画面で）' };
    if (existing.connection_type !== 'bluetooth' && existing.connection_type !== 'usb') {
      return { ok: false, error: 'Wi-Fi・LAN のプリンターは管理画面（設定 > レジ・プリンター）で設定します' };
    }
    const { error } = await supabase
      .from('printer_configs')
      .update({ cloudprnt_enabled: true, connection_type: via, updated_by: ctx.userId })
      .eq('id', existing.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { ok: false, error: `プリンターを使えるようにできませんでした: ${error.message}` };
    row = {
      id: existing.id as string,
      name: existing.name as string,
      maker: (existing.maker as string | null) ?? null,
      storeId: existing.store_id as string,
    };
    action = 'config_update';
  } else {
    const name = deviceReceiptPrinterName(input.name, maker);
    const { data: same } = await supabase
      .from('printer_configs')
      .select('id, name, maker')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', store.id)
      .eq('status', 'active')
      .eq('usage', 'receipt')
      .eq('name', name)
      .in('connection_type', ['bluetooth', 'usb'])
      .limit(1)
      .maybeSingle();
    if (same) {
      const { error } = await supabase
        .from('printer_configs')
        .update({ cloudprnt_enabled: true, connection_type: via, updated_by: ctx.userId })
        .eq('id', same.id)
        .eq('organization_id', ctx.organizationId);
      if (error) return { ok: false, error: `プリンターを使えるようにできませんでした: ${error.message}` };
      row = { id: same.id as string, name: same.name as string, maker: (same.maker as string | null) ?? null, storeId: store.id };
      action = 'config_update';
    } else {
      const { data: created, error } = await supabase
        .from('printer_configs')
        .insert({
          organization_id: ctx.organizationId,
          store_id: store.id,
          name,
          maker: BT_MAKER_SETTING[maker],
          connection_type: via,
          usage: 'receipt',
          paper_width_mm: 80,
          auto_print: false,
          // レシートプリンターにドロアをつなぐ前提（Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth」）
          drawer_kick: true,
          cloudprnt_enabled: true,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .select('id, name, maker')
        .single();
      if (error || !created) return { ok: false, error: `プリンターを追加できませんでした: ${error?.message ?? '不明なエラー'}` };
      row = { id: created.id as string, name: created.name as string, maker: (created.maker as string | null) ?? null, storeId: store.id };
    }
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: row.storeId,
    p_action: `settings.printers.${action}`,
    p_target_table: 'printer_configs',
    p_target_id: row.id,
    p_before: null,
    p_after: { name: row.name, usage: 'receipt', connection_type: via, enabled: true },
    p_note: 'iPad（レジの設定 > このiPadのプリンター）',
  });

  const jar = await cookies();
  jar.set(DEVICE_PRINTER_COOKIE, row.id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/app/pos/settings');
  revalidatePath('/app/settings/printers');

  return {
    ok: true,
    printer: {
      id: row.id,
      name: row.name,
      maker: row.maker ?? BT_MAKER_SETTING[bluetoothMakerOf(row.maker) ?? maker],
      usage: 'receipt',
      billSlips: false,
      ip: null,
      enabled: true,
      connection: via,
    },
  };
}
