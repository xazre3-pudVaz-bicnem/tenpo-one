'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { courseStepsFrom, MAX_COURSE_STEPS, normalizeStepIds, type CourseSteps } from '@/lib/course-steps';

export interface ActionResult {
  error?: string;
}

const ITEM_TYPES = ['food', 'drink', 'course', 'option'] as const;

export interface CategoryInput {
  id?: string;
  storeId: string;
  name: string;
  nameEn: string;
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
    name_en: input.nameEn.trim() || null,
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
  return {};
}

export interface MenuItemInput {
  id?: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  nameEn: string;
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
    name_en: input.nameEn.trim() || null,
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
    // 価格を入力（>0）したら「価格未設定」フラグを解除。0以下は未設定のまま（公開不可）。
    price_pending: input.price <= 0,
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
  // 値段などの変更をレジ・ハンディのメニューにも出す（これから入れる注文から。注文済みの明細は変えない）
  revalidatePath('/app/pos');
  revalidatePath('/handy', 'layout');
  return {};
}

const STATIONS = ['kitchen', 'drink', 'dessert', 'grill'] as const;

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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
  return {};
}

/**
 * コースの料理（出す順）を保存する（店舗ごと。store_settings.settings.courseSteps）。
 * 料理はその店のメニューにある商品から選ぶ。コースを注文すると厨房伝票に 1st / 2nd … と順番に出る
 * （lib/course-steps.ts。2026-10-03 御茶ノ水 Miyazaki「コースをオーダーしたとき料理が順番にプリントされるように」）。
 * settings の他の項目は消さずに courseSteps だけ書き換える。空にしたら、そのコースはこれまでどおりコース名だけ出す。
 */
export async function saveCourseSteps(storeId: string, courseId: string, itemIds: string[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  const ids = normalizeStepIds(itemIds);
  if (Array.isArray(itemIds) && itemIds.length > MAX_COURSE_STEPS) {
    return { error: `1つのコースに入れられる料理は${MAX_COURSE_STEPS}品までです` };
  }

  const supabase = await createClient();
  // コースと料理が、この会社・この店のメニューにあるか確かめる（他店の商品を入れさせない）
  const { data: found, error: findErr } = await supabase
    .from('menu_items')
    .select('id, item_type')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .in('id', [courseId, ...ids]);
  if (findErr) return { error: `メニューの確認に失敗しました: ${findErr.message}` };
  const byId = new Map((found ?? []).map((m) => [m.id as string, m.item_type as string]));
  if (byId.get(courseId) !== 'course') return { error: 'コースが見つかりません' };
  if (ids.some((id) => !byId.has(id))) return { error: 'メニューにない商品が入っています。画面を開き直してください' };
  if (ids.some((id) => id === courseId || byId.get(id) === 'course')) return { error: 'コースの中にコースは入れられません' };

  const { data: existing } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const before = courseStepsFrom(current);
  const nextSteps: CourseSteps = { ...before };
  if (ids.length > 0) nextSteps[courseId] = ids;
  else delete nextSteps[courseId];
  const nextSettings: Record<string, unknown> = { ...current };
  if (Object.keys(nextSteps).length > 0) nextSettings.courseSteps = nextSteps;
  else delete nextSettings.courseSteps;

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `コースの料理の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.menu.course_steps_update',
    p_target_table: 'store_settings',
    p_target_id: courseId,
    p_before: { steps: before[courseId] ?? [] },
    p_after: { steps: ids },
    p_note: null,
  });

  revalidatePath('/app/settings/plans');
  return {};
}
