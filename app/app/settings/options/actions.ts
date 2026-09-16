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

/** 選択肢グループを作成する（例: サイズ / トッピング） */
export async function createOptionGroup(input: {
  storeId: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };

  const name = input.name.trim();
  if (!name) return { error: 'グループ名を入力してください' };
  const min = Math.max(0, Math.floor(input.minSelect));
  const max = Math.max(1, Math.floor(input.maxSelect));
  if (min > max) return { error: '最小選択数は最大選択数以下にしてください' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('menu_option_groups')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', input.storeId);

  const { error } = await supabase.from('menu_option_groups').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    name,
    is_required: input.isRequired,
    min_select: min,
    max_select: max,
    sort_order: count ?? 0,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) return { error: `グループの作成に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/options');
  return {};
}

/** グループの設定を更新する */
export async function updateOptionGroup(input: {
  id: string;
  storeId: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };

  const name = input.name.trim();
  if (!name) return { error: 'グループ名を入力してください' };
  const min = Math.max(0, Math.floor(input.minSelect));
  const max = Math.max(1, Math.floor(input.maxSelect));
  if (min > max) return { error: '最小選択数は最大選択数以下にしてください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_option_groups')
    .update({ name, is_required: input.isRequired, min_select: min, max_select: max, updated_by: ctx.userId })
    .eq('id', input.id)
    .eq('store_id', input.storeId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/options');
  return {};
}

/** グループを削除する（紐付け・選択肢はDBのcascadeで一緒に消える） */
export async function deleteOptionGroup(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase.from('menu_option_groups').delete().eq('id', id).eq('store_id', storeId);
  if (error) return { error: `削除に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/options');
  return {};
}

/** グループに選択肢を追加する（追加料金つき） */
export async function addOptionItem(input: {
  groupId: string;
  storeId: string;
  name: string;
  price: number;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };

  const name = input.name.trim();
  if (!name) return { error: '選択肢名を入力してください' };
  if (!Number.isFinite(input.price)) return { error: '追加料金の指定が正しくありません' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('menu_option_items')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', input.groupId);

  const { error } = await supabase.from('menu_option_items').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    group_id: input.groupId,
    name,
    price: Math.round(input.price),
    sort_order: count ?? 0,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) return { error: `選択肢の追加に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/options');
  return {};
}

/** 選択肢を削除する */
export async function deleteOptionItem(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase.from('menu_option_items').delete().eq('id', id).eq('store_id', storeId);
  if (error) return { error: `削除に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/options');
  return {};
}

/** グループに紐づける商品を設定する（差し替え方式） */
export async function setGroupMenuItems(input: {
  groupId: string;
  storeId: string;
  menuItemIds: string[];
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };

  const supabase = await createClient();

  // 指定された商品が同一店舗のものであることを確認（他店舗の商品への紐付けを防ぐ）
  const ids = Array.from(new Set(input.menuItemIds));
  if (ids.length > 0) {
    const { data: valid } = await supabase
      .from('menu_items')
      .select('id')
      .in('id', ids)
      .eq('store_id', input.storeId)
      .eq('status', 'active');
    if ((valid ?? []).length !== ids.length) return { error: '対象外の商品が含まれています' };
  }

  const { error: delErr } = await supabase
    .from('menu_item_option_groups')
    .delete()
    .eq('group_id', input.groupId)
    .eq('store_id', input.storeId);
  if (delErr) return { error: `紐付けの更新に失敗しました: ${delErr.message}` };

  if (ids.length > 0) {
    const { error } = await supabase.from('menu_item_option_groups').insert(
      ids.map((menuItemId, i) => ({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        menu_item_id: menuItemId,
        group_id: input.groupId,
        sort_order: i,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      }))
    );
    if (error) return { error: `紐付けの登録に失敗しました: ${error.message}` };
  }

  revalidatePath('/app/settings/options');
  revalidatePath('/app/pos');
  return {};
}
