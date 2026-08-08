'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

const ITEM_TYPES = ['food', 'drink', 'course', 'option'] as const;

export interface CategoryInput {
  id?: string;
  storeId: string;
  name: string;
  color: string;
  sortOrder: number;
}

/** カテゴリの追加・更新 */
export async function saveCategory(input: CategoryInput): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const name = input.name.trim();
  if (!name) return { error: 'カテゴリ名を入力してください' };

  const supabase = await createClient();
  // 更新時は店舗スコープを変更しない（全店共通カテゴリを誤って店舗固定にしないため）store_idを含めない
  const basePayload = {
    organization_id: ctx.organizationId,
    name,
    color: input.color,
    sort_order: input.sortOrder,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase
      .from('menu_categories')
      .update(basePayload)
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `カテゴリの更新に失敗しました: ${error.message}` };
  } else {
    if (!ctx.stores.some((s) => s.id === input.storeId)) {
      return { error: '対象店舗にアクセス権がありません' };
    }
    const { error } = await supabase
      .from('menu_categories')
      .insert({ ...basePayload, store_id: input.storeId, created_by: ctx.userId });
    if (error) return { error: `カテゴリの追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: input.id ? 'settings.menu.category_update' : 'settings.menu.category_add',
    p_target_table: 'menu_categories',
    p_target_id: input.id ?? input.storeId,
    p_before: null,
    p_after: { name, color: input.color, sort_order: input.sortOrder },
    p_note: null,
  });

  revalidatePath('/app/settings/menu');
  return {};
}

/** カテゴリの削除（論理削除） */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_categories')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `カテゴリの削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.menu.category_delete',
    p_target_table: 'menu_categories',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'deleted' },
    p_note: null,
  });

  revalidatePath('/app/settings/menu');
  return {};
}

export interface MenuItemInput {
  id?: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  nameKana: string;
  description: string;
  itemType: string;
  price: number;
  takeoutPrice: number | null;
  cost: number | null;
  taxRateId: string | null;
  durationMinutes: number | null;
  sellStartTime: string | null;
  sellEndTime: string | null;
  sortOrder: number;
  status: 'active' | 'hidden' | 'deleted';
}

/** メニュー商品の追加・更新 */
export async function saveMenuItem(input: MenuItemInput): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const name = input.name.trim();
  if (!name) return { error: '商品名を入力してください' };
  if (!(ITEM_TYPES as readonly string[]).includes(input.itemType)) return { error: '種別の指定が不正です' };
  if (input.price < 0) return { error: '価格は0以上で入力してください' };

  const supabase = await createClient();
  // 更新時は店舗スコープを変更しない（全店共通商品を誤って店舗固定にしないため）store_idを含めない
  const basePayload = {
    organization_id: ctx.organizationId,
    category_id: input.categoryId,
    name,
    name_kana: input.nameKana.trim() || null,
    description: input.description.trim() || null,
    item_type: input.itemType,
    price: input.price,
    takeout_price: input.takeoutPrice,
    cost: input.cost,
    tax_rate_id: input.taxRateId,
    duration_minutes: input.itemType === 'course' ? input.durationMinutes : null,
    sell_start_time: input.sellStartTime,
    sell_end_time: input.sellEndTime,
    sort_order: input.sortOrder,
    status: input.status,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase
      .from('menu_items')
      .update(basePayload)
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `商品の更新に失敗しました: ${error.message}` };
  } else {
    if (!ctx.stores.some((s) => s.id === input.storeId)) {
      return { error: '対象店舗にアクセス権がありません' };
    }
    const { error } = await supabase
      .from('menu_items')
      .insert({ ...basePayload, store_id: input.storeId, created_by: ctx.userId });
    if (error) return { error: `商品の追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: input.id ? 'settings.menu.item_update' : 'settings.menu.item_add',
    p_target_table: 'menu_items',
    p_target_id: input.id ?? input.storeId,
    p_before: null,
    p_after: { name, item_type: input.itemType, price: input.price, status: input.status },
    p_note: null,
  });

  revalidatePath('/app/settings/menu');
  return {};
}

const STATIONS = ['kitchen', 'drink', 'dessert'] as const;

/** カテゴリのKDS振り分け先（station）を変更する。ここで設定した値が /app/kitchen のタブ振り分けに使われる */
export async function updateCategoryStation(id: string, station: string): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!(STATIONS as readonly string[]).includes(station)) return { error: 'ステーションの指定が不正です' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_categories')
    .update({ station, updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `ステーションの更新に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.menu.category_station',
    p_target_table: 'menu_categories',
    p_target_id: id,
    p_before: null,
    p_after: { station },
    p_note: null,
  });

  revalidatePath('/app/settings/menu');
  return {};
}

/** 商品の削除（論理削除） */
export async function deleteMenuItem(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_items')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `商品の削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.menu.item_delete',
    p_target_table: 'menu_items',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'deleted' },
    p_note: null,
  });

  revalidatePath('/app/settings/menu');
  return {};
}

/** 売切トグル（POSに即時反映） */
export async function toggleSoldOut(id: string, soldOut: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { error } = await supabase
    .from('menu_items')
    .update({ is_sold_out: soldOut, updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/menu');
  return {};
}
