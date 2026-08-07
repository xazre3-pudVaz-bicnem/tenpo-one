'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { IMPORT_TYPE_LIST_PATH } from '@/components/import/field-defs';
import type { ImportResult, ImportRowInput, ImportType } from '@/components/import/types';
import { MAX_IMPORT_ROWS } from '@/components/import/csv-parser';
import {
  validateCustomerRow,
  validateInventoryItemRow,
  validateMenuItemRow,
  validateVendorRow,
  type NormalizedCustomerRow,
  type NormalizedInventoryItemRow,
  type NormalizedMenuItemRow,
  type NormalizedVendorRow,
} from '@/components/import/validators';

const IMPORT_TYPES: ImportType[] = ['menu_items', 'customers', 'vendors', 'inventory_items'];

function assertType(type: string): asserts type is ImportType {
  if (!IMPORT_TYPES.includes(type as ImportType)) throw new Error('種別の指定が不正です');
}

type Ctx = Awaited<ReturnType<typeof requirePermission>>;

/** menu_items / inventory_items は店舗必須。設定画面で選択中の店舗（Cookie経由）をそのまま使う */
function resolveTargetStoreId(type: ImportType, ctx: Ctx): string | null {
  if (type !== 'menu_items' && type !== 'inventory_items') return null;
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) throw new Error('対象店舗が選択されていません。画面上部で店舗を選択してから再度お試しください');
  return store.id;
}

/**
 * 既存レコードから重複判定キーの集合を取得する。
 * - 商品/仕入先/在庫品目: 名前（小文字化）
 * - 顧客: 電話番号（数字のみ）
 * 対象組織（在庫品目はさらに対象店舗）の有効なレコードを全件取得して照合する。
 * プレビュー時の事前確認・実行時の最終確認の双方で使用する。
 */
async function fetchExistingKeys(
  type: ImportType,
  ctx: Ctx,
  storeId: string | null
): Promise<Set<string>> {
  const supabase = await createClient();
  const keys = new Set<string>();

  if (type === 'menu_items') {
    const { data } = await supabase
      .from('menu_items')
      .select('name')
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted');
    for (const r of data ?? []) keys.add(r.name.trim().toLowerCase());
  } else if (type === 'customers') {
    const { data } = await supabase
      .from('customers')
      .select('phone')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .not('phone', 'is', null);
    for (const r of data ?? []) if (r.phone) keys.add(r.phone.replace(/[^0-9]/g, ''));
  } else if (type === 'vendors') {
    const { data } = await supabase
      .from('vendors')
      .select('name')
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted');
    for (const r of data ?? []) keys.add(r.name.trim().toLowerCase());
  } else {
    const { data } = await supabase
      .from('inventory_items')
      .select('name')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', storeId as string)
      .neq('status', 'deleted');
    for (const r of data ?? []) keys.add(r.name.trim().toLowerCase());
  }
  return keys;
}

/**
 * プレビュー画面向け: 渡された重複判定キーのうち、既に登録済みのものだけを返す。
 * あくまで画面表示（スキップ予定の明示）のためのもので、実際のスキップ判定は importRows 側で改めて行う。
 */
export async function checkExistingDuplicates(type: string, dupKeys: string[]): Promise<string[]> {
  assertType(type);
  const ctx = await requirePermission('org.settings');
  const storeId = resolveTargetStoreId(type, ctx);
  const existing = await fetchExistingKeys(type, ctx, storeId);
  return dupKeys.filter((k) => existing.has(k));
}

/** カテゴリ名からmenu_categories.idを解決する。既存になければ新規作成する（find-or-create） */
async function resolveCategoryIds(
  categoryNames: string[],
  ctx: Ctx,
  storeId: string
): Promise<Map<string, string>> {
  const supabase = await createClient();
  const map = new Map<string, string>();
  if (categoryNames.length === 0) return map;

  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');
  const byLower = new Map((existing ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  // 大文字小文字違いの表記ゆれで同じカテゴリが二重作成されないよう、小文字化したキーで一意化してから作成する
  const toCreateByLower = new Map<string, string>(); // lower -> 採用する表記（最初に出てきたもの）
  for (const name of categoryNames) {
    if (byLower.has(name.toLowerCase())) continue;
    if (!toCreateByLower.has(name.toLowerCase())) toCreateByLower.set(name.toLowerCase(), name);
  }
  const toCreate = Array.from(toCreateByLower.values());

  if (toCreate.length > 0) {
    // 新規カテゴリも1回のinsert呼び出しでまとめて作成する（同じ理由: 部分的な作成失敗を避ける）
    const { data: created, error } = await supabase
      .from('menu_categories')
      .insert(
        toCreate.map((name) => ({
          organization_id: ctx.organizationId,
          store_id: storeId,
          name,
          color: '#7B3FF2',
          sort_order: 0,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        }))
      )
      .select('id, name');
    if (error) throw new Error(`カテゴリの作成に失敗しました: ${error.message}`);
    for (const c of created ?? []) byLower.set(c.name.trim().toLowerCase(), c.id);
  }

  for (const name of categoryNames) {
    const id = byLower.get(name.toLowerCase());
    if (id) map.set(name, id);
  }

  return map;
}

/**
 * CSVインポート実行。
 *
 * 設計上の要点:
 * 1. クライアントを一切信用しない — 受け取った生の文字列を毎回サーバー側で再検証する（components/import/validators.ts）。
 * 2. 重複（商品/仕入先/在庫品目=同名、顧客=電話番号一致）は登録直前にDBへ再照会して除外する
 *    （プレビュー表示後に他の操作で登録された分も考慮するため）。
 * 3. 検証・重複除外を終えた「有効行」は insert() を1回だけ呼び出して一括登録する。
 *    Supabase/PostgRESTの insert は複数行分をまとめて1つのSQL INSERT文として実行するため、
 *    途中の1行で制約違反等が起きた場合はトランザクション全体がロールバックされ「全行失敗」となる。
 *    これにより、行ごとにinsertを繰り返す実装で起こりがちな「半分だけ登録された」状態を構造的に防いでいる。
 */
export async function importRows(type: string, rows: ImportRowInput[]): Promise<ImportResult> {
  assertType(type);
  const ctx = await requirePermission('org.settings');

  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, skipped: 0, failed: [] };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`一度にインポートできるのは${MAX_IMPORT_ROWS}行までです`);
  }

  const storeId = resolveTargetStoreId(type, ctx);
  const supabase = await createClient();

  const failed: { rowNumber: number; reason: string }[] = [];
  let skipped = 0;

  type Valid<T> = { rowNumber: number; dupKey: string | null; data: T };
  const validMenuItems: Valid<NormalizedMenuItemRow>[] = [];
  const validCustomers: Valid<NormalizedCustomerRow>[] = [];
  const validVendors: Valid<NormalizedVendorRow>[] = [];
  const validInventory: Valid<NormalizedInventoryItemRow>[] = [];

  for (const row of rows) {
    if (type === 'menu_items') {
      const r = validateMenuItemRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validMenuItems.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
    } else if (type === 'customers') {
      const r = validateCustomerRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validCustomers.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
    } else if (type === 'vendors') {
      const r = validateVendorRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validVendors.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
    } else {
      const r = validateInventoryItemRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validInventory.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
    }
  }

  const existingKeys = await fetchExistingKeys(type, ctx, storeId);

  /** ファイル内重複（先勝ち）とDB既存重複を除外する。除外した行数は戻り値に加算する */
  function dedupe<T>(items: Valid<T>[]): Valid<T>[] {
    const seen = new Set<string>();
    const kept: Valid<T>[] = [];
    for (const item of items) {
      if (item.dupKey !== null) {
        if (seen.has(item.dupKey) || existingKeys.has(item.dupKey)) {
          skipped += 1;
          continue;
        }
        seen.add(item.dupKey);
      }
      kept.push(item);
    }
    return kept;
  }

  let inserted = 0;

  if (type === 'menu_items') {
    const kept = dedupe(validMenuItems);
    if (kept.length > 0) {
      try {
        const categoryNames = Array.from(
          new Set(kept.map((k) => k.data.categoryName).filter((n): n is string => !!n))
        );
        const categoryMap = await resolveCategoryIds(categoryNames, ctx, storeId as string);
        const payload = kept.map((k) => ({
          organization_id: ctx.organizationId,
          store_id: storeId,
          category_id: k.data.categoryName ? (categoryMap.get(k.data.categoryName) ?? null) : null,
          name: k.data.name,
          name_kana: k.data.nameKana,
          item_type: k.data.itemType,
          price: k.data.price,
          takeout_price: k.data.takeoutPrice,
          cost: k.data.cost,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        }));
        const { error } = await supabase.from('menu_items').insert(payload);
        if (error) throw new Error(error.message);
        inserted = payload.length;
      } catch (err) {
        const reason = err instanceof Error ? err.message : '登録に失敗しました';
        for (const k of kept) failed.push({ rowNumber: k.rowNumber, reason });
      }
    }
  } else if (type === 'customers') {
    const kept = dedupe(validCustomers);
    if (kept.length > 0) {
      const payload = kept.map((k) => ({
        organization_id: ctx.organizationId,
        primary_store_id: ctx.currentStore?.id ?? null,
        name: k.data.name,
        name_kana: k.data.nameKana,
        phone: k.data.phone,
        email: k.data.email,
        birthday: k.data.birthday,
        allergy_note: k.data.allergyNote,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      }));
      const { error } = await supabase.from('customers').insert(payload);
      if (error) for (const k of kept) failed.push({ rowNumber: k.rowNumber, reason: error.message });
      else inserted = payload.length;
    }
  } else if (type === 'vendors') {
    const kept = dedupe(validVendors);
    if (kept.length > 0) {
      const payload = kept.map((k) => ({
        organization_id: ctx.organizationId,
        name: k.data.name,
        name_kana: k.data.nameKana,
        phone: k.data.phone,
        email: k.data.email,
        closing_day: k.data.closingDay,
        payment_day: k.data.paymentDay,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      }));
      const { error } = await supabase.from('vendors').insert(payload);
      if (error) for (const k of kept) failed.push({ rowNumber: k.rowNumber, reason: error.message });
      else inserted = payload.length;
    }
  } else {
    const kept = dedupe(validInventory);
    if (kept.length > 0) {
      const payload = kept.map((k) => ({
        organization_id: ctx.organizationId,
        store_id: storeId,
        name: k.data.name,
        item_kind: k.data.itemKind,
        unit: k.data.unit,
        current_quantity: k.data.currentQuantity,
        reorder_point: k.data.reorderPoint,
        avg_cost: k.data.avgCost,
        purchase_unit: k.data.purchaseUnit,
        purchase_to_stock_factor: k.data.purchaseToStockFactor,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      }));
      const { error } = await supabase.from('inventory_items').insert(payload);
      if (error) for (const k of kept) failed.push({ rowNumber: k.rowNumber, reason: error.message });
      else inserted = payload.length;
    }
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: `import.${type}`,
    p_target_table: type,
    p_target_id: ctx.organizationId,
    p_before: null,
    p_after: { inserted, skipped, failed: failed.length, total_rows: rows.length },
    p_note: null,
  });

  revalidatePath(IMPORT_TYPE_LIST_PATH[type]);
  revalidatePath('/app/settings/import');

  return { inserted, skipped, failed };
}
