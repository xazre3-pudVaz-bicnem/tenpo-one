'use server';

import { revalidatePath } from 'next/cache';
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
