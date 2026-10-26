'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { courseStepsFrom, MAX_COURSE_STEPS, normalizeStepIds, type CourseSteps } from '@/lib/course-steps';
import { findOrphanMenuItemIds } from '@/lib/orphan-menu-items';

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
  /**
   * コース・プランの中身の印（menu_items.course_includes_drinks / course_includes_ayce。フロアの「飲放／食放」、
   * ハンディのモード選択に使う）。undefined は変えない（Web の商品の画面からは送らない）
   */
  courseIncludesDrinks?: boolean | null;
  courseIncludesAyce?: boolean | null;
}

/** メニュー商品の追加・更新。id は保存した商品（追加したときは新しい id。iPad のコースの作成で使う） */
export async function saveMenuItem(input: MenuItemInput): Promise<ActionResult & { id?: string }> {
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
    ...(input.courseIncludesDrinks !== undefined ? { course_includes_drinks: input.courseIncludesDrinks } : {}),
    ...(input.courseIncludesAyce !== undefined ? { course_includes_ayce: input.courseIncludesAyce } : {}),
  };

  let savedId = input.id;
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
    const { data: created, error } = await supabase
      .from('menu_items')
      .insert({ ...basePayload, store_id: input.storeId, created_by: ctx.userId })
      .select('id')
      .single();
    if (error) return { error: `商品の追加に失敗しました: ${error.message}` };
    savedId = (created?.id as string | undefined) ?? undefined;
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
  return savedId ? { id: savedId } : {};
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

/** 注文時の会計伝票（カテゴリごとに明示的に有効化）。 */
export async function updateCategoryOrderSlip(id: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (typeof enabled !== 'boolean') return { error: '設定値が不正です' };
  const supabase = await createClient();
  const { data: category } = await supabase.from('menu_categories').select('id, store_id')
    .eq('id', id).eq('organization_id', ctx.organizationId).eq('status', 'active').maybeSingle();
  if (!category || (category.store_id && !ctx.isHq && !ctx.stores.some((s) => s.id === category.store_id))) {
    return { error: '対象カテゴリにアクセス権がありません' };
  }
  const { error } = await supabase.from('menu_categories').update({ print_order_slip: enabled, updated_by: ctx.userId })
    .eq('id', id).eq('organization_id', ctx.organizationId);
  if (error) return { error: `会計伝票の設定を保存できませんでした: ${error.message}` };
  await supabase.rpc('log_audit', { p_org: ctx.organizationId, p_store: category.store_id,
    p_action: 'settings.menu.category_order_slip', p_target_table: 'menu_categories', p_target_id: id,
    p_before: null, p_after: { print_order_slip: enabled }, p_note: null });
  revalidatePath('/app/settings/categories');
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
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
  return {};
}

export interface DeleteOrphanResult extends ActionResult {
  deleted?: number;
}

/** 1回の update に入れる id の数（URL が長くなりすぎないように） */
const ORPHAN_CHUNK = 200;

/**
 * 消したカテゴリに残っている商品（＋カテゴリ無しの商品。レジの「その他（価格入力）」用は除く）をまとめて削除扱いにする。
 * カテゴリの削除は商品を消さないので、店のメニューを入れ直したあとに旧商品がこの状態で溜まり、
 * 商品が 1,000 件を超えるとレジ・ハンディ・設定画面が最初の 1,000 件しか読めなくなる
 * （2026-10-17 SHUNKA 新宿本店：旧商品 919 件）。店長以上（menu.manage）。対象はいま選んでいる店舗だけ。
 */
export async function deleteOrphanMenuItems(storeId: string): Promise<DeleteOrphanResult> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { error: 'この店舗の操作はできません' };
  const supabase = await createClient();

  let ids: string[];
  try {
    ids = await findOrphanMenuItemIds(supabase, ctx.organizationId, storeId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : '商品の読み込みに失敗しました' };
  }
  if (ids.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (let i = 0; i < ids.length; i += ORPHAN_CHUNK) {
    const chunk = ids.slice(i, i + ORPHAN_CHUNK);
    const { error } = await supabase
      .from('menu_items')
      .update({ status: 'deleted', updated_by: ctx.userId })
      .in('id', chunk)
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', storeId)
      .neq('status', 'deleted');
    if (error) return { error: `${deleted}件削除したあと、失敗しました: ${error.message}（画面を開き直して確認してください）`, deleted };
    deleted += chunk.length;
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.menu.orphan_items_delete',
    p_target_table: 'menu_items',
    p_target_id: storeId,
    p_before: null,
    p_after: { status: 'deleted', items: deleted },
    p_note: null,
  });

  for (const path of ['/app/settings/menu', '/app/settings/plans', '/app/settings/categories', '/app/settings/menu-book', '/app/settings/menu-bulk', '/app/pos', '/app/pos/sold-out']) {
    revalidatePath(path);
  }
  revalidatePath('/handy', 'layout');
  return { deleted };
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
  // コースは種別「コース」でなくてもよい（取り込んだままで種別がフードのコースもある。2026-10-05 御茶ノ水）
  if (!byId.has(courseId) || byId.get(courseId) === 'option') return { error: 'コースが見つかりません' };
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
  revalidatePath('/app/settings/menu');
  return {};
}
