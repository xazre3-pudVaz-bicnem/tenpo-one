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
  deviceReceiptPrinterName,
  type BtMaker,
} from '@/lib/direct-print';
import { makerSettingOf, printerModelById, type PrinterModel } from '@/lib/printer-models';

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
  model: string | null;
  usage: 'receipt';
  billSlips: false;
  ip: null;
  enabled: true;
  connection: 'bluetooth' | 'usb';
  paperWidthMm: 58 | 80;
  autoPrint: boolean;
  drawerKick: boolean;
}

type PrinterSettingsInput = {
  /** 機種（lib/printer-models.ts の id） */
  modelId?: string | null;
  /** レシート紙幅 */
  paperWidthMm?: number | null;
  /** 会計レシート自動印刷 */
  autoPrint?: boolean | null;
  /** キャッシュドロア利用 */
  drawerKick?: boolean | null;
};

/** 機種・紙幅・自動印刷・ドロアの保存する値（渡されたものだけ） */
function settingsPatch(input: PrinterSettingsInput, model: PrinterModel | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (model) {
    patch.model = model.name;
    patch.maker = makerSettingOf(model);
  }
  const paper = input.paperWidthMm === 58 || input.paperWidthMm === 80 ? input.paperWidthMm : model?.paper;
  if (paper) patch.paper_width_mm = paper;
  if (typeof input.autoPrint === 'boolean') patch.auto_print = input.autoPrint;
  if (typeof input.drawerKick === 'boolean') patch.drawer_kick = input.drawerKick;
  else if (model) patch.drawer_kick = model.drawer;
  return patch;
}

/**
 * 名前：見つけた機械の名前（「TM-m30III（シリアル）」など。1台ずつ別の名前になるので、同じ店の2台の iPad が
 * 同じ行を使ってしまうことがない）。機械の名前が無ければ機種名。
 */
function nameFor(model: PrinterModel | null, deviceName: string | null | undefined, maker: BtMaker): string {
  if (deviceName && deviceName.trim()) return deviceReceiptPrinterName(deviceName, maker);
  if (model && model.maker !== 'escpos') return model.name;
  return deviceReceiptPrinterName(deviceName, maker);
}

type Ctx = Awaited<ReturnType<typeof requireSession>>;

/** この人の店舗の、iPad とつなぐ（Bluetooth・USB）レシートプリンターの行 */
async function myDeviceReceiptPrinter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: Ctx,
  printerId: string
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; error: string }> {
  if (!UUID.test(printerId)) return { ok: false, error: 'プリンターが見つかりません' };
  const { data: existing } = await supabase
    .from('printer_configs')
    .select('id, name, maker, model, store_id, usage, connection_type, status, paper_width_mm, auto_print, drawer_kick')
    .eq('id', printerId)
    .eq('organization_id', ctx.organizationId!)
    .maybeSingle();
  const inMyStore = existing && (ctx.isHq || ctx.stores.some((s) => s.id === existing.store_id));
  if (!existing || !inMyStore || existing.status !== 'active') return { ok: false, error: 'プリンターが見つかりません' };
  if (existing.usage !== 'receipt') return { ok: false, error: 'レシートのプリンターではありません（厨房用は管理画面で）' };
  if (existing.connection_type !== 'bluetooth' && existing.connection_type !== 'usb') {
    return { ok: false, error: 'Wi-Fi・LAN のプリンターは管理画面（設定 > レジ・プリンター）で設定します' };
  }
  return { ok: true, row: existing as Record<string, unknown> };
}

function toAdded(row: Record<string, unknown>, via: 'bluetooth' | 'usb'): AddedDevicePrinter {
  return {
    id: row.id as string,
    name: row.name as string,
    maker: (row.maker as string | null) ?? 'その他',
    model: (row.model as string | null) ?? null,
    usage: 'receipt',
    billSlips: false,
    ip: null,
    enabled: true,
    connection: via,
    paperWidthMm: row.paper_width_mm === 58 ? 58 : 80,
    autoPrint: row.auto_print === true,
    drawerKick: row.drawer_kick === true,
  };
}

const ROW_COLUMNS = 'id, name, maker, model, store_id, paper_width_mm, auto_print, drawer_kick, connection_type';

/**
 * iPad（TENPO ONE レジ アプリ）でつないだ Bluetooth・USB のレシートプリンター（＋ドロア）を、その場で店のプリンターにする。
 * 2026-10-13 Ronnie「iPad アプリでプリンターの設定。レシートは Bluetooth から」（Airレジのように iPad だけで済む。パソコン不要）。
 * 2026-10-14 Ronnie「プリンター選択がいる」：機種（mC-Print3・TM-m30III など）・紙幅・会計レシート自動印刷・ドロアも一緒に保存。
 *   - printerId なし：この店のレシートプリンターとして追加（同じ名前・つなぎ方の行があればそれを使う。二重に作らない）
 *   - printerId あり：その行（このiPadのプリンター・管理画面で Bluetooth・USB として足したもの）を、見つけた機械・機種に合わせて使えるようにする
 *   どちらも、このiPadのレシートの出し先にする（cookie）。
 * 店長以上（設定 > レジ・プリンター と同じ権限）。厨房・ドリンクのプリンター、Wi-Fi・LAN はここでは触らない（管理画面だけ）。
 */
export async function addDeviceReceiptPrinter(
  input: {
    printerId?: string | null;
    name?: string | null;
    maker: string;
    via: string;
  } & PrinterSettingsInput
): Promise<{ ok: true; printer: AddedDevicePrinter } | { ok: false; error: string }> {
  const ctx = await requireSession();
  if (!ctx.organizationId) return { ok: false, error: 'ログインしてください' };
  if (!can(ctx.role, 'store.settings')) return { ok: false, error: 'プリンターの追加は店長以上のアカウントでできます' };
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { ok: false, error: '店舗を選んでください' };
  if (!BT_MAKERS.includes(input.maker as BtMaker)) return { ok: false, error: 'プリンターの種類が分かりません' };
  const maker = input.maker as BtMaker;
  const via: 'bluetooth' | 'usb' = input.via === 'usb' ? 'usb' : 'bluetooth';
  const model = printerModelById(input.modelId);
  if (input.modelId && !model) return { ok: false, error: 'プリンターの機種が分かりません' };
  if (model && !model.ready) return { ok: false, error: `${model.name} は準備中です` };
  const patch = settingsPatch(input, model);

  const supabase = await createClient();
  let row: Record<string, unknown> | null = null;
  let action: 'config_add' | 'config_update' = 'config_add';

  if (input.printerId) {
    const found = await myDeviceReceiptPrinter(supabase, ctx, input.printerId);
    if (!found.ok) return found;
    const update: Record<string, unknown> = { ...patch, cloudprnt_enabled: true, connection_type: via, updated_by: ctx.userId };
    // 機種を選び直した・別の機械につなぎ直したときは名前も合わせる
    if (model || input.name) update.name = nameFor(model, input.name, maker);
    const { data, error } = await supabase
      .from('printer_configs')
      .update(update)
      .eq('id', found.row.id as string)
      .eq('organization_id', ctx.organizationId)
      .select(ROW_COLUMNS)
      .single();
    if (error || !data) return { ok: false, error: `プリンターを使えるようにできませんでした: ${error?.message ?? '不明なエラー'}` };
    row = data as Record<string, unknown>;
    action = 'config_update';
  } else {
    const name = nameFor(model, input.name, maker);
    const { data: same } = await supabase
      .from('printer_configs')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', store.id)
      .eq('status', 'active')
      .eq('usage', 'receipt')
      .eq('name', name)
      .in('connection_type', ['bluetooth', 'usb'])
      .limit(1)
      .maybeSingle();
    if (same) {
      const { data, error } = await supabase
        .from('printer_configs')
        .update({ ...patch, cloudprnt_enabled: true, connection_type: via, updated_by: ctx.userId })
        .eq('id', same.id)
        .eq('organization_id', ctx.organizationId)
        .select(ROW_COLUMNS)
        .single();
      if (error || !data) return { ok: false, error: `プリンターを使えるようにできませんでした: ${error?.message ?? '不明なエラー'}` };
      row = data as Record<string, unknown>;
      action = 'config_update';
    } else {
      const { data, error } = await supabase
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
          ...patch,
          cloudprnt_enabled: true,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .select(ROW_COLUMNS)
        .single();
      if (error || !data) return { ok: false, error: `プリンターを追加できませんでした: ${error?.message ?? '不明なエラー'}` };
      row = data as Record<string, unknown>;
    }
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: row.store_id as string,
    p_action: `settings.printers.${action}`,
    p_target_table: 'printer_configs',
    p_target_id: row.id as string,
    p_before: null,
    p_after: { name: row.name, model: row.model ?? null, usage: 'receipt', connection_type: via, enabled: true },
    p_note: 'iPad（レジの設定 > このiPadのプリンター）',
  });

  const jar = await cookies();
  jar.set(DEVICE_PRINTER_COOKIE, row.id as string, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/app/pos/settings');
  revalidatePath('/app/settings/printers');

  return { ok: true, printer: toAdded(row, via) };
}

/**
 * このiPadのプリンターの設定を保存（Airレジの「保存する」。機種・紙幅・会計レシート自動印刷・キャッシュドロア利用）。
 * 2026-10-14 Ronnie「プリンター選択がいる」。店長以上・iPad とつなぐレシートプリンターだけ。
 */
export async function saveDeviceReceiptPrinterSettings(
  input: { printerId: string } & PrinterSettingsInput
): Promise<{ ok: true; printer: AddedDevicePrinter } | { ok: false; error: string }> {
  const ctx = await requireSession();
  if (!ctx.organizationId) return { ok: false, error: 'ログインしてください' };
  if (!can(ctx.role, 'store.settings')) return { ok: false, error: 'プリンターの設定は店長以上のアカウントで変えられます' };
  const model = printerModelById(input.modelId);
  if (input.modelId && !model) return { ok: false, error: 'プリンターの機種が分かりません' };
  if (model && !model.ready) return { ok: false, error: `${model.name} は準備中です` };

  const supabase = await createClient();
  const found = await myDeviceReceiptPrinter(supabase, ctx, input.printerId);
  if (!found.ok) return found;
  const update: Record<string, unknown> = { ...settingsPatch(input, model), updated_by: ctx.userId };
  const { data, error } = await supabase
    .from('printer_configs')
    .update(update)
    .eq('id', found.row.id as string)
    .eq('organization_id', ctx.organizationId)
    .select(ROW_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: `保存できませんでした: ${error?.message ?? '不明なエラー'}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: data.store_id as string,
    p_action: 'settings.printers.config_update',
    p_target_table: 'printer_configs',
    p_target_id: data.id as string,
    p_before: null,
    p_after: {
      name: data.name,
      model: data.model ?? null,
      paper_width_mm: data.paper_width_mm,
      auto_print: data.auto_print,
      drawer_kick: data.drawer_kick,
    },
    p_note: 'iPad（レジの設定 > このiPadのプリンター）',
  });
  revalidatePath('/app/pos/settings');
  revalidatePath('/app/settings/printers');
  const via = data.connection_type === 'usb' ? 'usb' : 'bluetooth';
  return { ok: true, printer: toAdded(data as Record<string, unknown>, via) };
}
