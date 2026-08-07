'use server';

import { randomUUID } from 'crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

function assertStoreAccess(storeIds: string[], storeId: string): string | null {
  return storeIds.includes(storeId) ? null : '対象店舗にアクセス権がありません';
}

/** フロア追加 */
export async function addFloor(storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    storeId
  );
  if (err) return { error: err };
  if (!name.trim()) return { error: 'フロア名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase.from('floors').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    name: name.trim(),
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) return { error: `フロアの追加に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/tables');
  return {};
}

/** フロア名変更 */
export async function renameFloor(floorId: string, storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    storeId
  );
  if (err) return { error: err };
  if (!name.trim()) return { error: 'フロア名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('floors')
    .update({ name: name.trim(), updated_by: ctx.userId })
    .eq('id', floorId)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `フロア名の変更に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/tables');
  return {};
}

/** フロア削除（論理削除） */
export async function deleteFloor(floorId: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    storeId
  );
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('floors')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', floorId)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `フロアの削除に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/tables');
  return {};
}

export interface TableInput {
  id?: string;
  storeId: string;
  floorId: string | null;
  name: string;
  capacityMin: number;
  capacityMax: number;
  isPrivateRoom: boolean;
  isCounter: boolean;
  smokingAllowed: boolean;
  sortOrder: number;
}

/** テーブル追加・更新 */
export async function saveTable(input: TableInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    input.storeId
  );
  if (err) return { error: err };
  if (!input.name.trim()) return { error: 'テーブル名を入力してください' };
  if (input.capacityMin < 1 || input.capacityMax < input.capacityMin) {
    return { error: '席数の指定が正しくありません' };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    floor_id: input.floorId,
    name: input.name.trim(),
    capacity_min: input.capacityMin,
    capacity_max: input.capacityMax,
    is_private_room: input.isPrivateRoom,
    is_counter: input.isCounter,
    smoking_allowed: input.smokingAllowed,
    sort_order: input.sortOrder,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase.from('restaurant_tables').update(payload).eq('id', input.id);
    if (error) return { error: `テーブルの更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase.from('restaurant_tables').insert({ ...payload, created_by: ctx.userId });
    if (error) return { error: `テーブルの追加に失敗しました: ${error.message}` };
  }

  revalidatePath('/app/settings/tables');
  return {};
}

/** テーブルの利用停止・再開（current_status） */
export async function toggleTableAvailability(tableId: string, storeId: string, available: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    storeId
  );
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('restaurant_tables')
    .update({ current_status: available ? 'available' : 'unavailable', updated_by: ctx.userId })
    .eq('id', tableId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/tables');
  return {};
}

/** テーブル削除（論理削除・予約履歴保全） */
export async function deleteTable(tableId: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    storeId
  );
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('restaurant_tables')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', tableId);
  if (error) return { error: `テーブルの削除に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/tables');
  return {};
}

// ---------------------------------------------------------------
// QRオーダー用QRコードの発行（PHASE 10）
// テーブルの qr_token は一覧には出さず、ダイアログを開いたときのみ取得する
// ---------------------------------------------------------------

export interface TableQrResult {
  error?: string;
  url?: string;
  dataUrl?: string;
}

/** リクエストの origin（本番は NEXT_PUBLIC_SITE_URL を優先） */
async function resolveOrigin(): Promise<string> {
  const headerList = await headers();
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${headerList.get('x-forwarded-proto') ?? 'https'}://${headerList.get('host')}`
  );
}

/** 対象テーブルを取得し、店舗アクセス権を検証する */
async function loadTableForQr(
  ctx: { isHq: boolean; stores: { id: string }[] },
  tableId: string
): Promise<
  | { error: string }
  | { table: { id: string; name: string; qr_token: string; store_id: string; slug: string } }
> {
  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, qr_token, store_id, stores(slug)')
    .eq('id', tableId)
    .single();
  if (!table || !table.qr_token) return { error: 'テーブルが見つかりません' };

  const err = assertStoreAccess(
    ctx.stores.map((s) => s.id),
    table.store_id
  );
  if (err) return { error: err };

  const store = table.stores as unknown as { slug: string } | null;
  if (!store) return { error: '店舗情報が見つかりません' };

  return {
    table: { id: table.id, name: table.name, qr_token: table.qr_token, store_id: table.store_id, slug: store.slug },
  };
}

async function buildTableQr(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 320, margin: 1 });
}

/** テーブルのQRコード（注文ページURL・QR画像）を取得する */
export async function getTableQr(tableId: string): Promise<TableQrResult> {
  const ctx = await requirePermission('store.settings');
  const result = await loadTableForQr(ctx, tableId);
  if ('error' in result) return { error: result.error };

  const origin = await resolveOrigin();
  const url = `${origin}/order/${result.table.slug}/${result.table.qr_token}`;
  const dataUrl = await buildTableQr(url);
  return { url, dataUrl };
}

/** テーブルのQRトークンを再発行する（旧QRコードは即時に無効化される） */
export async function regenerateTableQrToken(tableId: string): Promise<TableQrResult> {
  const ctx = await requirePermission('store.settings');
  const result = await loadTableForQr(ctx, tableId);
  if ('error' in result) return { error: result.error };

  // DBのデフォルト生成（gen_random_uuid() を2つ連結）と同じ強度のトークンを発行する
  const newToken = (randomUUID() + randomUUID()).replaceAll('-', '');

  const supabase = await createClient();
  const { error } = await supabase
    .from('restaurant_tables')
    .update({ qr_token: newToken, updated_by: ctx.userId })
    .eq('id', tableId)
    .eq('store_id', result.table.store_id);
  if (error) return { error: `トークンの再発行に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: result.table.store_id,
    p_action: 'table.qr_token_regenerate',
    p_target_table: 'restaurant_tables',
    p_target_id: tableId,
    p_before: { qr_token: result.table.qr_token },
    p_after: { qr_token: newToken },
    p_note: '旧QRコードは無効化されました',
  });

  revalidatePath('/app/settings/tables');

  const origin = await resolveOrigin();
  const url = `${origin}/order/${result.table.slug}/${newToken}`;
  const dataUrl = await buildTableQr(url);
  return { url, dataUrl };
}
