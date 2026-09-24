'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  isHm,
  MENU_BOOK_SHOWS,
  menuBookFrom,
  menuBookToJson,
  normalizePageName,
  PAGE_KEY_RE,
  type MenuBookSettings,
  type MenuBookShow,
} from '@/lib/menu-book';
import { cleanTakeoutItemIds } from '@/lib/takeout-menu';

/**
 * メニューブック（ハンディ・お客様QRに出すカテゴリの並び順と出し方、ページ（タブのまとめ方）、商品の並び順、
 * プランで出すカテゴリ、ランチの時間帯）の保存。店長以上（menu.manage）だけ。
 * 並び順は menu_categories / menu_items の sort_order（レジ・ハンディ・お客様QR共通）、
 * 出し方などは store_settings.settings.menuBook（DB 変更なし）に入れる。
 * ハンディ・お客様QRは毎回DBから読むので、保存すればそのまま反映される。
 */

export interface ActionResult {
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 並び順の間隔（あとで間に差し込めるよう10おき） */
const SORT_STEP = 10;

type Ctx = Awaited<ReturnType<typeof requirePermission>>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

function canUseStore(ctx: Ctx, storeId: string): boolean {
  return ctx.isHq || ctx.stores.some((s) => s.id === storeId);
}

function revalidateMenus() {
  revalidatePath('/app/settings/menu-book');
  revalidatePath('/app/settings/menu');
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/pos');
  revalidatePath('/handy', 'layout');
}

/** store_settings.settings.menuBook を読み、書き換えて保存する（settings の他の項目は消さない） */
async function updateMenuBook(
  ctx: Ctx,
  supabase: Supabase,
  storeId: string,
  mutate: (book: MenuBookSettings) => void
): Promise<string | null> {
  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return `店舗設定の読み込みに失敗しました: ${readError.message}`;
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const book = menuBookFrom(current);
  mutate(book);
  const nextSettings = { ...current, menuBook: menuBookToJson(book) };
  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  return error ? `メニューブックの保存に失敗しました: ${error.message}` : null;
}

async function audit(ctx: Ctx, supabase: Supabase, storeId: string, action: string, after: Record<string, unknown>) {
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: action,
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: after,
    p_note: null,
  });
}

/** 並び順を sort_order に書く（変わった行だけ更新） */
async function writeSortOrder(
  supabase: Supabase,
  table: 'menu_categories' | 'menu_items',
  organizationId: string,
  ordered: string[],
  current: Map<string, number>,
  userId: string
): Promise<string | null> {
  const updates = ordered
    .map((id, i) => ({ id, sort: (i + 1) * SORT_STEP }))
    .filter((u) => current.get(u.id) !== u.sort);
  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from(table)
        .update({ sort_order: u.sort, updated_by: userId })
        .eq('id', u.id)
        .eq('organization_id', organizationId)
    )
  );
  const failed = results.find((r) => r.error);
  return failed?.error ? `並び順の保存に失敗しました: ${failed.error.message}` : null;
}

export interface CategoryLayoutRow {
  id: string;
  /** 'auto' はカテゴリ名と値段からの自動判定に戻す */
  show: MenuBookShow | 'auto';
}

/** カテゴリの並び順（上から順）と、ハンディ・お客様QRでの出し方 */
export async function saveCategoryLayout(storeId: string, rows: CategoryLayoutRow[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: 'この店舗の操作はできません' };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) return { error: 'カテゴリがありません' };
  const ids = rows.map((r) => r.id);
  if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return { error: 'カテゴリの指定が正しくありません' };
  }
  if (rows.some((r) => r.show !== 'auto' && !(MENU_BOOK_SHOWS as readonly string[]).includes(r.show))) {
    return { error: '出し方の指定が正しくありません' };
  }

  const supabase = await createClient();
  const { data: categories, error } = await supabase
    .from('menu_categories')
    .select('id, sort_order')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .or(`store_id.is.null,store_id.eq.${storeId}`);
  if (error) return { error: `カテゴリの読み込みに失敗しました: ${error.message}` };
  const current = new Map((categories ?? []).map((c) => [c.id as string, c.sort_order as number]));
  if (ids.some((id) => !current.has(id))) {
    return { error: 'カテゴリが見つかりません。画面を開き直してください' };
  }

  const sortError = await writeSortOrder(supabase, 'menu_categories', ctx.organizationId, ids, current, ctx.userId);
  if (sortError) return { error: sortError };

  const settingsError = await updateMenuBook(ctx, supabase, storeId, (book) => {
    for (const r of rows) {
      if (r.show === 'auto') delete book.categories[r.id];
      else book.categories[r.id] = r.show;
    }
  });
  if (settingsError) return { error: settingsError };

  await audit(ctx, supabase, storeId, 'settings.menu_book.categories_update', {
    categories: rows.length,
    custom: rows.filter((r) => r.show !== 'auto').length,
  });
  revalidateMenus();
  return {};
}

/** 1カテゴリの商品の並び順（上から順） */
export async function saveItemOrder(storeId: string, categoryId: string, itemIds: string[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: 'この店舗の操作はできません' };
  if (!UUID.test(categoryId)) return { error: 'カテゴリの指定が正しくありません' };
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 1000) return { error: '商品がありません' };
  if (itemIds.some((id) => !UUID.test(id)) || new Set(itemIds).size !== itemIds.length) {
    return { error: '商品の指定が正しくありません' };
  }

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from('menu_items')
    .select('id, sort_order')
    .eq('organization_id', ctx.organizationId)
    .eq('category_id', categoryId)
    .neq('status', 'deleted')
    .or(`store_id.is.null,store_id.eq.${storeId}`);
  if (error) return { error: `商品の読み込みに失敗しました: ${error.message}` };
  const current = new Map((items ?? []).map((i) => [i.id as string, i.sort_order as number]));
  if (itemIds.some((id) => !current.has(id))) {
    return { error: '商品が見つかりません。画面を開き直してください' };
  }

  const sortError = await writeSortOrder(supabase, 'menu_items', ctx.organizationId, itemIds, current, ctx.userId);
  if (sortError) return { error: sortError };

  await audit(ctx, supabase, storeId, 'settings.menu_book.items_order', { category_id: categoryId, items: itemIds.length });
  revalidateMenus();
  return {};
}

export interface PlanCategoriesRow {
  planItemId: string;
  /** null は「プランのときだけのカテゴリを全部出す」（指定なし） */
  categoryIds: string[] | null;
}

/** プラン（コース・飲み放題）ごとに出すカテゴリ */
export async function saveMenuBookPlans(storeId: string, rows: PlanCategoriesRow[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: 'この店舗の操作はできません' };
  if (!Array.isArray(rows) || rows.length > 500) return { error: 'プランの指定が正しくありません' };
  for (const r of rows) {
    if (!UUID.test(r.planItemId)) return { error: 'プランの指定が正しくありません' };
    if (r.categoryIds !== null && (!Array.isArray(r.categoryIds) || r.categoryIds.some((id) => !UUID.test(id)))) {
      return { error: 'カテゴリの指定が正しくありません' };
    }
  }

  const supabase = await createClient();
  const planIds = rows.map((r) => r.planItemId);
  if (planIds.length > 0) {
    const { data: found, error } = await supabase
      .from('menu_items')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .in('id', planIds);
    if (error) return { error: `プランの読み込みに失敗しました: ${error.message}` };
    if ((found ?? []).length !== new Set(planIds).size) return { error: 'プランが見つかりません。画面を開き直してください' };
  }

  const settingsError = await updateMenuBook(ctx, supabase, storeId, (book) => {
    for (const r of rows) {
      if (r.categoryIds === null) delete book.plans[r.planItemId];
      else book.plans[r.planItemId] = [...new Set(r.categoryIds)];
    }
  });
  if (settingsError) return { error: settingsError };

  await audit(ctx, supabase, storeId, 'settings.menu_book.plans_update', {
    plans: rows.length,
    selected: rows.filter((r) => r.categoryIds !== null).length,
  });
  revalidateMenus();
  return {};
}

export interface MenuBookPagesInput {
  /** 上のタブの並び（key と名前） */
  pages: { key: string; name: string }[];
  /** カテゴリID → タブのkey */
  categoryPage: Record<string, string>;
}

/**
 * ページ ＝ レジ・ハンディ・お客様QRの上のタブ（ランチ・ドリンク・フード…）。
 * タブの並びと、どのカテゴリをどのタブに入れるかを保存する。
 * カテゴリを指定していないタブは自動判定（autoCategoryPage）のまま。
 */
export async function saveMenuBookPages(storeId: string, input: MenuBookPagesInput): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: 'この店舗の操作はできません' };
  const rawPages = Array.isArray(input?.pages) ? input.pages : null;
  const rawMap = input?.categoryPage && typeof input.categoryPage === 'object' ? Object.entries(input.categoryPage) : null;
  if (!rawPages || !rawMap || rawPages.length === 0 || rawPages.length > 40 || rawMap.length > 2000) {
    return { error: 'ページの指定が正しくありません' };
  }

  const pages: { key: string; name: string }[] = [];
  const keys = new Set<string>();
  for (const p of rawPages) {
    const key = typeof p?.key === 'string' ? p.key : '';
    const name = normalizePageName(p?.name);
    if (!PAGE_KEY_RE.test(key)) return { error: `ページの記号が正しくありません: ${String(key)}` };
    if (!name) return { error: 'ページの名前を入れてください' };
    if (keys.has(key)) return { error: `同じ記号のページが2つあります: ${key}` };
    keys.add(key);
    pages.push({ key, name });
  }

  const ids = rawMap.map(([id]) => id);
  if (ids.some((id) => !UUID.test(id))) return { error: 'カテゴリの指定が正しくありません' };
  if (rawMap.some(([, key]) => typeof key !== 'string' || !keys.has(key))) {
    return { error: '無いページにカテゴリを入れようとしています。画面を開き直してください' };
  }

  const supabase = await createClient();
  if (ids.length > 0) {
    const { data: found, error } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .in('id', [...new Set(ids)]);
    if (error) return { error: `カテゴリの読み込みに失敗しました: ${error.message}` };
    if ((found ?? []).length !== new Set(ids).size) {
      return { error: 'カテゴリが見つかりません。画面を開き直してください' };
    }
  }

  const categoryPage: Record<string, string> = {};
  for (const [id, key] of rawMap) categoryPage[id] = key as string;
  const settingsError = await updateMenuBook(ctx, supabase, storeId, (book) => {
    book.pages = pages;
    book.categoryPage = categoryPage;
  });
  if (settingsError) return { error: settingsError };

  await audit(ctx, supabase, storeId, 'settings.menu_book.pages_update', {
    pages: pages.length,
    assigned: Object.keys(categoryPage).length,
  });
  revalidateMenus();
  return {};
}

/** ランチの時間帯（「ランチの時間だけ」のカテゴリを出す時間） */
export async function saveMenuBookLunch(storeId: string, start: string, end: string): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: 'この店舗の操作はできません' };
  if (!isHm(start) || !isHm(end)) return { error: '時刻は HH:MM で指定してください' };
  if (start === end) return { error: '開始と終了を別の時刻にしてください' };

  const supabase = await createClient();
  const settingsError = await updateMenuBook(ctx, supabase, storeId, (book) => {
    book.lunch = { start, end };
  });
  if (settingsError) return { error: settingsError };

  await audit(ctx, supabase, storeId, 'settings.menu_book.lunch_update', { start, end });
  revalidateMenus();
  return {};
}

/**
 * テイクアウト専用メニューの保存（2026-09-25 店舗要望）。
 * ここに入れた商品だけがテイクアウト伝票で打てる（テイクアウトは軽減税率8%）。
 * 何も入れていない店舗は、テイクアウトでは商品を出さない。
 * 保存先は store_settings.settings.takeoutMenu（menuBook とは別。DB 変更なし）。
 */
export async function saveTakeoutMenu(storeId: string, itemIds: string[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!canUseStore(ctx, storeId)) return { error: '担当外の店舗です' };
  const ids = cleanTakeoutItemIds(itemIds);
  const supabase = await createClient();

  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('menu_items')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .in('id', ids);
    if ((rows ?? []).length !== ids.length) return { error: 'この会社にない商品が含まれています' };
  }

  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return { error: `設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, takeoutMenu: { itemIds: ids } },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `テイクアウトメニューの保存に失敗しました: ${error.message}` };

  revalidateMenus();
  return {};
}
