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
    const { error } = await supabase
      .from('menu_categories')
      .insert({ ...basePayload, store_id: input.storeId, created_by: ctx.userId });
    if (error) return { error: `カテゴリの追加に失敗しました: ${error.message}` };
  }

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
    const { error } = await supabase
      .from('menu_items')
      .insert({ ...basePayload, store_id: input.storeId, created_by: ctx.userId });
    if (error) return { error: `商品の追加に失敗しました: ${error.message}` };
  }

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
