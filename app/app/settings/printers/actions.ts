'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { PrintResultStatus } from '@/lib/printing/types';

export interface ActionResult {
  error?: string;
}

export interface CreateTestPrintResult extends ActionResult {
  jobId?: string;
}

function assertStoreAccess(storeIds: string[], storeId: string): string | null {
  return storeIds.includes(storeId) ? null : '対象店舗にアクセス権がありません';
}

/** レジ端末の追加 */
export async function addRegister(storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };
  if (!name.trim()) return { error: 'レジ名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase.from('registers').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    name: name.trim(),
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) return { error: `レジの追加に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.register_add',
    p_target_table: 'registers',
    p_target_id: storeId,
    p_before: null,
    p_after: { name: name.trim() },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** レジ端末の名前変更 */
export async function renameRegister(id: string, storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };
  if (!name.trim()) return { error: 'レジ名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registers')
    .update({ name: name.trim(), updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `レジ名の変更に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.register_rename',
    p_target_table: 'registers',
    p_target_id: id,
    p_before: null,
    p_after: { name: name.trim() },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** レジ端末の無効化・有効化 */
export async function toggleRegisterActive(id: string, storeId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registers')
    .update({ status: active ? 'active' : 'inactive', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.register_toggle',
    p_target_table: 'registers',
    p_target_id: id,
    p_before: null,
    p_after: { status: active ? 'active' : 'inactive' },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

export interface PrinterConfigInput {
  id?: string;
  storeId: string;
  name: string;
  maker: string;
  model: string;
  connectionType: string;
  ipAddress: string;
  usage: string;
  paperWidthMm: number;
  autoPrint: boolean;
  drawerKick: boolean;
}

/** プリンター設定の追加・更新 */
export async function savePrinterConfig(input: PrinterConfigInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };
  if (!input.name.trim()) return { error: 'プリンター名を入力してください' };

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    name: input.name.trim(),
    maker: input.maker.trim() || null,
    model: input.model.trim() || null,
    connection_type: input.connectionType || null,
    ip_address: input.ipAddress.trim() || null,
    usage: input.usage,
    paper_width_mm: input.paperWidthMm,
    auto_print: input.autoPrint,
    drawer_kick: input.drawerKick,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase
      .from('printer_configs')
      .update(payload)
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `プリンター設定の更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase.from('printer_configs').insert({ ...payload, created_by: ctx.userId });
    if (error) return { error: `プリンター設定の追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: input.id ? 'settings.printers.config_update' : 'settings.printers.config_add',
    p_target_table: 'printer_configs',
    p_target_id: input.id ?? input.storeId,
    p_before: null,
    p_after: { name: input.name.trim(), usage: input.usage, connection_type: input.connectionType || null },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** プリンター設定の削除（論理削除） */
export async function deletePrinterConfig(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('printer_configs')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `プリンター設定の削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.config_delete',
    p_target_table: 'printer_configs',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'deleted' },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** テスト印刷ジョブの作成（ブラウザ印刷） */
export async function createTestPrint(printerConfigId: string, storeId: string): Promise<CreateTestPrintResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('print_jobs')
    .insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      printer_config_id: printerConfigId,
      job_type: 'test',
      target: 'browser',
      status: 'queued',
      payload: {},
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { error: `テスト印刷の作成に失敗しました: ${error?.message ?? '不明なエラー'}` };

  return { jobId: data.id as string };
}

/** テスト印刷ページ側で印刷完了を記録 */
export async function markPrintJobPrinted(jobId: string): Promise<ActionResult> {
  await requirePermission('store.settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('print_jobs')
    .update({ status: 'printed', printed_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Mock障害シミュレーション（createMockPrintProvider）の結果を print_jobs へ記録する。
 * print_jobs.status は('queued','printed','failed')のみのため、successのみprinted・
 * それ以外（paper_out/offline/timeout/error）はfailedとしてerrorに日本語理由を残す。
 */
export async function finalizeTestPrintJob(
  jobId: string,
  status: PrintResultStatus,
  message?: string
): Promise<ActionResult> {
  await requirePermission('store.settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('print_jobs')
    .update({
      status: status === 'success' ? 'printed' : 'failed',
      error: status === 'success' ? null : (message ?? status),
      printed_at: status === 'success' ? new Date().toISOString() : null,
    })
    .eq('id', jobId);
  if (error) return { error: error.message };
  return {};
}

export interface DrawerSettings {
  autoOpenOnCash: boolean;
  openOnCashless: boolean;
}

/** ドロア設定を取得する（store_settings.settings jsonb の drawer キー） */
export async function getDrawerSettings(storeId: string): Promise<DrawerSettings> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { autoOpenOnCash: true, openOnCashless: false };

  const supabase = await createClient();
  const { data } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const drawer = (data?.settings as { drawer?: Partial<DrawerSettings> } | null)?.drawer;
  return {
    autoOpenOnCash: drawer?.autoOpenOnCash ?? true,
    openOnCashless: drawer?.openOnCashless ?? false,
  };
}

/** ドロア設定を保存する（他のsettingsキーを壊さないよう既存jsonbへマージする） */
export async function saveDrawerSettings(storeId: string, drawer: DrawerSettings): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const nextSettings = { ...((existing?.settings as Record<string, unknown> | null) ?? {}), drawer };

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `ドロア設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.drawer_update',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: drawer,
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}
