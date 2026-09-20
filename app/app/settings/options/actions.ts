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
  /** 英語名（任意）。厨房伝票とレジ画面に英語で出す */
  nameEn?: string;
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
    name_en: (input.nameEn ?? '').trim() || null,
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

/**
 * dinii から移行した「【グループ名】選択肢名」形式のオプション商品（種別=オプション）を、
 * 本物の選択肢グループ＋選択肢に変換する。
 *
 * 2026-09-15 の移行時は TENPO ONE に選択肢グループが無く、dinii のオプションを
 * 「オプション」カテゴリの商品として「【Choice Curry (Lunch)】F. Today's Chicken Curry」のように登録した。
 * 現場では「セットの選べる（カレー・ナン/ご飯・ドリンク）が出ない」となるため、ここで一括変換する。
 *
 * - グループ名（【】の中）ごとにグループを作る（同名があれば再利用）。既定は 必須・1〜1。
 * - 選択肢は商品名（】の後）と商品の英語名・価格をそのまま使う。同じ選択肢は二重登録しない。
 * - 元のオプション商品は消さない（会計履歴が参照している可能性があるため）。POS の商品一覧に出さないよう
 *   売切にはせず、そのまま残す。不要なら後で商品設定から非表示にする。
 * - どのセット商品に付けるか（紐付け）は変換後に「対象商品」で選ぶ（dinii の紐付け情報は移行されていない）。
 */
export async function convertOptionProductsToGroups(storeId: string): Promise<ActionResult & { groups?: number; options?: number; skipped?: number }> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };
  const supabase = await createClient();

  const { data: products } = await supabase
    .from('menu_items')
    .select('id, name, name_en, price, sort_order')
    .eq('store_id', storeId)
    .eq('item_type', 'option')
    .eq('status', 'active')
    .order('sort_order');

  const parsed = (products ?? [])
    .map((p) => {
      const m = /^【(.+?)】\s*(.+)$/.exec(p.name.trim());
      if (!m) return null;
      const nameEn = (p.name_en ?? '').trim();
      // 英語名側にも【】が付いていれば外す
      const en = nameEn ? nameEn.replace(/^【.+?】\s*/, '') : '';
      return { group: m[1].trim(), option: m[2].trim(), nameEn: en && en !== m[2].trim() ? en : null, price: p.price as number };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (parsed.length === 0) return { error: '「【グループ名】選択肢名」形式のオプション商品がありません' };

  const { data: existingGroups } = await supabase
    .from('menu_option_groups')
    .select('id, name')
    .eq('store_id', storeId)
    .eq('status', 'active');
  const groupIdByName = new Map((existingGroups ?? []).map((g) => [g.name.trim().toLowerCase(), g.id as string]));

  const { data: existingOptions } = await supabase
    .from('menu_option_items')
    .select('name, group_id')
    .eq('store_id', storeId)
    .eq('status', 'active');
  const existingOptionKeys = new Set((existingOptions ?? []).map((o) => `${o.group_id}|${o.name.trim().toLowerCase()}`));

  let createdGroups = 0;
  let sortBase = groupIdByName.size;
  const groupNames = Array.from(new Set(parsed.map((p) => p.group)));
  for (const name of groupNames) {
    const key = name.toLowerCase();
    if (groupIdByName.has(key)) continue;
    // Topping / Tsuika / Level 系は任意（0〜n）、それ以外（Choice 等）は必須・1つ
    const optional = /topping|tsuika|追加|level|glass|トッピング/i.test(name);
    const optionCount = parsed.filter((p) => p.group === name).length;
    const { data: created, error } = await supabase
      .from('menu_option_groups')
      .insert({
        organization_id: ctx.organizationId,
        store_id: storeId,
        name,
        is_required: !optional,
        min_select: optional ? 0 : 1,
        max_select: optional ? Math.max(1, optionCount) : 1,
        sort_order: sortBase++,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error || !created) return { error: `グループの作成に失敗しました: ${error?.message ?? ''}` };
    groupIdByName.set(key, created.id as string);
    createdGroups += 1;
  }

  const rows: Record<string, unknown>[] = [];
  const countByGroup = new Map<string, number>();
  let skipped = 0;
  for (const p of parsed) {
    const groupId = groupIdByName.get(p.group.toLowerCase());
    if (!groupId) continue;
    const k = `${groupId}|${p.option.toLowerCase()}`;
    if (existingOptionKeys.has(k)) {
      skipped += 1;
      continue;
    }
    existingOptionKeys.add(k);
    const n = countByGroup.get(groupId) ?? 0;
    countByGroup.set(groupId, n + 1);
    rows.push({
      organization_id: ctx.organizationId,
      store_id: storeId,
      group_id: groupId,
      name: p.option,
      name_en: p.nameEn,
      price: Math.round(p.price),
      sort_order: n,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('menu_option_items').insert(rows);
    if (error) return { error: `選択肢の登録に失敗しました: ${error.message}` };
  }

  revalidatePath('/app/settings/options');
  revalidatePath('/app/pos');
  return { groups: createdGroups, options: rows.length, skipped };
}
