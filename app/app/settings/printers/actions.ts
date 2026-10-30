'use server';

import { normalizeFloorIds } from '@/lib/printer-floors';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { PrintResultStatus } from '@/lib/printing/types';
import {
  isKitchenTicketTextSize,
  type KitchenTicketSettings,
} from '@/lib/kitchen-ticket';
import { normalizeVisitSourceIds } from '@/lib/handy-visit';
// ハードウェア（レジ端末・プリンター・ドロア）の変更は管理画面だけ。レジ端末（iPad）からは断る（2026-09-29 Ronnie）
import { ADMIN_ONLY_MESSAGE, ADMIN_ONLY_SETTINGS_NOTE } from '@/lib/admin-only-settings';
// LAN・Wi-Fi のプリンターは運営（コントロールセンター）だけ（2026-10-25 Ronnie）。入力チェックと列は運営と同じ（lib/network-printers.ts）
import { isNetworkConnection, NETWORK_PRINTER_ADMIN_NOTE, printerConfigColumns, printerConfigError, STORE_CAN_EDIT_NETWORK_PRINTERS } from '@/lib/network-printers';
// プリンター接続（CloudPRNT・Server Direct Print・iPad）の設定は運営（コントロールセンター）だけ（2026-10-25 Ronnie）。テスト印刷はお店でも
import { canEditPrinterConnection, cloudPrntConfigPatch, PRINTER_CONNECTION_ADMIN_NOTE } from '@/lib/printer-connection';
import { CLOUDPRNT_TEST_JOB, cloudPrntTestError, cloudPrntTestPayload, newCloudPrntToken } from '@/lib/cloudprnt-test-job';

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
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
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
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
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
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
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
  /** 担当フロア（floors.id）。レシート機・厨房機。空＝既定プリンター */
  floorIds?: string[];
  /** 厨房（ドリンク）機から会計伝票も出す */
  billSlips?: boolean;
  /** プリンターを上下さかさまに付けているとき（印字を180度回して出す） */
  upsideDown?: boolean;
}

/** プリンター設定の追加・更新 */
export async function savePrinterConfig(input: PrinterConfigInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };
  // 有線LAN・Wi-Fi のプリンターは運営（コントロールセンター）で追加・変更する。お店の管理画面からは断る
  if (!STORE_CAN_EDIT_NETWORK_PRINTERS && isNetworkConnection(input.connectionType)) return { error: NETWORK_PRINTER_ADMIN_NOTE };
  const inputError = printerConfigError(input);
  if (inputError) return { error: inputError };

  const supabase = await createClient();

  // 今 LAN・Wi-Fi の行は、お店からは変えない（Bluetooth などへの付け替えも運営で）
  if (input.id && !STORE_CAN_EDIT_NETWORK_PRINTERS) {
    const { data: current } = await supabase
      .from('printer_configs')
      .select('id, connection_type')
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (current && isNetworkConnection(current.connection_type)) return { error: NETWORK_PRINTER_ADMIN_NOTE };
  }

  // 担当フロアはこの店舗のフロアだけ受け付ける（他店舗のIDや削除済みは捨てる）。ラベル機は空
  let floorIds: string[] = [];
  if (input.usage !== 'label' && Array.isArray(input.floorIds) && input.floorIds.length > 0) {
    const { data: floors } = await supabase
      .from('floors')
      .select('id')
      .eq('store_id', input.storeId)
      .eq('status', 'active');
    floorIds = normalizeFloorIds(input.floorIds, new Set((floors ?? []).map((f) => f.id as string)));
  }

  const payload = {
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    ...printerConfigColumns(input, floorIds),
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
    p_after: { name: input.name.trim(), usage: input.usage, connection_type: input.connectionType || null, floor_ids: floorIds },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** プリンター設定の削除（論理削除） */
export async function deletePrinterConfig(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  // 有線LAN・Wi-Fi のプリンターは運営（コントロールセンター）で消す
  if (!STORE_CAN_EDIT_NETWORK_PRINTERS) {
    const { data: current } = await supabase
      .from('printer_configs')
      .select('id, connection_type')
      .eq('id', id)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (current && isNetworkConnection(current.connection_type)) return { error: NETWORK_PRINTER_ADMIN_NOTE };
  }

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
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
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

export interface KitchenTicketSettingsInput {
  split: KitchenTicketSettings['split'];
  language: KitchenTicketSettings['language'];
  /** 省略時は今の値のまま（レジ iPad の画面では文字の大きさを出さないため） */
  textSize?: KitchenTicketSettings['textSize'];
}

/**
 * 厨房伝票の分け方・商品名の言語・（パソコンの管理画面だけ）文字の大きさ（店舗ごと。store_settings.settings.kitchenTicket）。
 * settings の他の項目（ドロア・印字文字など）と kitchenTicket の他の項目（buzzer など）は消さずに上書きする。
 */
export async function saveKitchenTicketSettings(storeId: string, next: KitchenTicketSettingsInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_SETTINGS_NOTE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };
  if (next.split !== 'item' && next.split !== 'order') return { error: '伝票の分け方が正しくありません' };
  if (next.textSize !== undefined && !isKitchenTicketTextSize(next.textSize)) return { error: '文字の大きさが正しくありません' };
  if (next.language !== 'both' && next.language !== 'en') return { error: '商品名の言語が正しくありません' };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const before = (current.kitchenTicket as Record<string, unknown> | undefined) ?? {};
  const nextSettings = {
    ...current,
    kitchenTicket: {
      ...before,
      split: next.split,
      language: next.language,
      ...(next.textSize !== undefined ? { textSize: next.textSize } : {}),
    },
  };

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `厨房伝票の設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.printers.kitchen_ticket_update',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: { split: before.split ?? null, textSize: before.textSize ?? null, language: before.language ?? null },
    p_after: { split: next.split, textSize: next.textSize ?? before.textSize ?? null, language: next.language },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  revalidatePath('/app/pos/settings');
  return {};
}

// -------------------------------------------------------------
// CloudPRNT（Star mC-Print3 等）連携
// -------------------------------------------------------------

/**
 * CloudPRNTの有効化・ドロア命令・ポーリング間隔を更新する。
 * 接続の設定は運営（コントロールセンター）で行う（2026-10-25 Ronnie）。お店の管理画面からは運営のアカウントだけ
 * （運営コンソール側は app/admin/organizations/printer-connection-actions.ts）。中身の組み立ては運営と同じ（lib/printer-connection.ts）。
 */
export async function setCloudPrntConfig(input: {
  id: string;
  storeId: string;
  enabled: boolean;
  drawerCommand?: string;
  pollIntervalSeconds?: number;
  /** キッチン機が担当する厨房ステーション（kitchen / drink / dessert） */
  kitchenStations?: string[];
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
  if (!canEditPrinterConnection(ctx)) return { error: PRINTER_CONNECTION_ADMIN_NOTE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };

  const built = cloudPrntConfigPatch(input);
  if (!built.ok) return { error: built.error };
  const patch: Record<string, unknown> = { ...built.value, updated_by: ctx.userId };

  const supabase = await createClient();
  const { error } = await supabase
    .from('printer_configs')
    .update(patch)
    .eq('id', input.id)
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', input.storeId);
  if (error) return { error: `CloudPRNT設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.printers.cloudprnt_update',
    p_target_table: 'printer_configs',
    p_target_id: input.id,
    p_before: null,
    p_after: { enabled: input.enabled },
    p_note: null,
  });

  revalidatePath('/app/settings/printers');
  return {};
}

/** CloudPRNTトークンを再発行する（漏洩時など。既存URLは無効になる）。運営のアカウントだけ（ふだんは運営コンソールで） */
export async function regenerateCloudPrntToken(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };
  if (!canEditPrinterConnection(ctx)) return { error: PRINTER_CONNECTION_ADMIN_NOTE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  // 推測不能なトークンをサーバ側で生成（node:crypto）。
  const token = await newCloudPrntToken();

  const supabase = await createClient();
  const { error } = await supabase
    .from('printer_configs')
    .update({ cloudprnt_token: token, updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', storeId);
  if (error) return { error: `トークンの再発行に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/printers');
  return {};
}

/**
 * CloudPRNTのテスト印字（またはドロア開放）をキューに積む。プリンタが次のポーリングで取得・実行する。
 * お店のスタッフの動作確認なので、運営でなくても使える（中身は運営コンソールと同じ。lib/cloudprnt-test-job.ts）。
 */
export async function enqueueCloudPrntTest(
  id: string,
  storeId: string,
  kind: 'receipt' | 'drawer'
): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { data: printer } = await supabase
    .from('printer_configs')
    .select('id, cloudprnt_enabled, paper_width_mm, drawer_command, usage, drawer_kick')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  const testError = cloudPrntTestError(printer, kind);
  if (testError || !printer) return { error: testError ?? 'プリンタ設定が見つかりません' };

  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).single();
  const payload = await cloudPrntTestPayload(printer, kind, store?.name ?? 'TENPO ONE');

  const { error } = await supabase.from('print_jobs').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    printer_config_id: printer.id,
    ...CLOUDPRNT_TEST_JOB,
    payload,
    created_by: ctx.userId,
  });
  if (error) return { error: `テストジョブの登録に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/printers');
  return {};
}

/**
 * この店で使う来店経路（store_settings.settings.visitSources）。2026-09-24 店舗要望。
 * settings の他の項目は消さずに上書きする。
 */
export async function saveVisitSources(storeId: string, ids: string[]): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_SETTINGS_NOTE };
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const next = normalizeVisitSourceIds(ids);
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      {
        organization_id: ctx.organizationId,
        store_id: storeId,
        settings: { ...current, visitSources: next },
        updated_by: ctx.userId,
      },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `来店経路の保存に失敗しました: ${error.message}` };
  return {};
}
