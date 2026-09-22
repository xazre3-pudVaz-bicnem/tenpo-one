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
  validateOptionGroupRow,
  validateVendorRow,
  menuItemDupKey,
  type NormalizedCustomerRow,
  type NormalizedInventoryItemRow,
  type NormalizedMenuItemRow,
  type NormalizedOptionGroupRow,
  type NormalizedVendorRow,
} from '@/components/import/validators';

const IMPORT_TYPES: ImportType[] = ['menu_items', 'menu_option_groups', 'customers', 'vendors', 'inventory_items'];

function assertType(type: string): asserts type is ImportType {
  if (!IMPORT_TYPES.includes(type as ImportType)) throw new Error('種別の指定が不正です');
}

type Ctx = Awaited<ReturnType<typeof requirePermission>>;

/** menu_items / inventory_items は店舗必須。設定画面で選択中の店舗（Cookie経由）をそのまま使う */
function resolveTargetStoreId(type: ImportType, ctx: Ctx): string | null {
  if (type !== 'menu_items' && type !== 'menu_option_groups' && type !== 'inventory_items') return null;
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
    // 商品は店舗ごとに独立して持つ。重複判定も対象店舗内に限定する
    // （他店舗に同名商品があっても取込をブロックしない）。
    // 同じ商品名でもカテゴリが違えば別商品（「カテゴリ名|商品名」で判定）
    for (const r of await fetchStoreMenuItems(ctx, storeId as string)) keys.add(r.key);
  } else if (type === 'menu_option_groups') {
    // 「グループ名|選択肢名」（小文字化）。同じグループに同じ選択肢を二重登録しない
    const { data } = await supabase
      .from('menu_option_items')
      .select('name, menu_option_groups!inner(name)')
      .eq('store_id', storeId as string)
      .eq('status', 'active');
    for (const r of data ?? []) {
      const g = r.menu_option_groups as unknown as { name: string } | null;
      if (g) keys.add(`${g.name.trim().toLowerCase()}|${r.name.trim().toLowerCase()}`);
    }
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
 * 対象店舗の商品（削除済みを除く）を「カテゴリ名|商品名」キー付きで返す。
 * カテゴリ名は menu_categories から引く（カテゴリ未設定の商品はカテゴリ名を空として扱う）。
 */
async function fetchStoreMenuItems(
  ctx: Ctx,
  storeId: string
): Promise<{ id: string; name: string; key: string }[]> {
  const supabase = await createClient();
  const [{ data: items }, { data: cats }] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id, name, category_id')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', storeId)
      .neq('status', 'deleted'),
    supabase
      .from('menu_categories')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', storeId),
  ]);
  const catName = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  return ((items ?? []) as { id: string; name: string; category_id: string | null }[]).map((r) => ({
    id: r.id,
    name: r.name,
    key: menuItemDupKey(r.category_id ? (catName.get(r.category_id) ?? '') : '', r.name),
  }));
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

  // カテゴリも店舗ごとに独立しているため、対象店舗のカテゴリだけを照合する。
  // org全体で探すと他店舗のカテゴリIDを流用してしまい、商品が別店舗のカテゴリに紐づく。
  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', storeId)
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
  const validOptionRows: Valid<NormalizedOptionGroupRow>[] = [];

  for (const row of rows) {
    if (type === 'menu_items') {
      const r = validateMenuItemRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validMenuItems.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
    } else if (type === 'menu_option_groups') {
      const r = validateOptionGroupRow(row.values);
      if (!r.ok) failed.push({ rowNumber: row.rowNumber, reason: r.errors.join(' / ') });
      else validOptionRows.push({ rowNumber: row.rowNumber, dupKey: r.dupKey, data: r.data });
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
  let updated = 0;

  if (type === 'menu_items') {
    // 登録済みの商品（同じカテゴリ・同じ商品名）と一致する行は「英語名・カナの上書き更新」に使う（現場の要望: 全商品に英語を付けたい）。
    // それ以外の項目（価格・カテゴリ等）は触らない。英語名もカナも無い行は従来どおりスキップ。
    // 同じ商品名でもカテゴリが違えば別商品として新規登録する（dinii と同じ持ち方）。
    const existingIdByName = new Map(
      (await fetchStoreMenuItems(ctx, storeId as string)).map((r) => [r.key, r.id])
    );

    const seen = new Set<string>();
    const toInsert: Valid<NormalizedMenuItemRow>[] = [];
    const toUpdate: { id: string; name_en?: string; name_kana?: string; duration_minutes?: number }[] = [];
    for (const item of validMenuItems) {
      const key = item.dupKey ?? '';
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const existingId = existingIdByName.get(key);
      if (existingId) {
        const patch: { id: string; name_en?: string; name_kana?: string; duration_minutes?: number } = { id: existingId };
        if (item.data.nameEn) patch.name_en = item.data.nameEn;
        if (item.data.nameKana) patch.name_kana = item.data.nameKana;
        // コースの所要時間も登録済み商品へ後から入れられるようにする（dinii のプラン時間の移行用）
        if (item.data.durationMinutes !== null) patch.duration_minutes = item.data.durationMinutes;
        if (patch.name_en || patch.name_kana || patch.duration_minutes) toUpdate.push(patch);
        else skipped += 1;
        continue;
      }
      if (item.data.price === null) {
        failed.push({ rowNumber: item.rowNumber, reason: '新しい商品には価格を入力してください' });
        continue;
      }
      toInsert.push(item);
    }

    for (const patch of toUpdate) {
      const { id, ...fields } = patch;
      const { error } = await supabase
        .from('menu_items')
        .update({ ...fields, updated_by: ctx.userId })
        .eq('id', id)
        .eq('store_id', storeId as string);
      if (error) failed.push({ rowNumber: 0, reason: `更新に失敗しました: ${error.message}` });
      else updated += 1;
    }

    if (toInsert.length > 0) {
      try {
        const categoryNames = Array.from(
          new Set(toInsert.map((k) => k.data.categoryName).filter((n): n is string => !!n))
        );
        const categoryMap = await resolveCategoryIds(categoryNames, ctx, storeId as string);
        const payload = toInsert.map((k) => ({
          organization_id: ctx.organizationId,
          store_id: storeId,
          category_id: k.data.categoryName ? (categoryMap.get(k.data.categoryName) ?? null) : null,
          name: k.data.name,
          name_kana: k.data.nameKana,
          name_en: k.data.nameEn,
          item_type: k.data.itemType,
          price: k.data.price ?? 0,
          takeout_price: k.data.takeoutPrice,
          cost: k.data.cost,
          duration_minutes: k.data.itemType === 'course' ? k.data.durationMinutes : null,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        }));
        const { error } = await supabase.from('menu_items').insert(payload);
        if (error) throw new Error(error.message);
        inserted = payload.length;
      } catch (err) {
        const reason = err instanceof Error ? err.message : '登録に失敗しました';
        for (const k of toInsert) failed.push({ rowNumber: k.rowNumber, reason });
      }
    }
  } else if (type === 'menu_option_groups') {
    // 登録済みの選択肢（同じグループ名＋選択肢名）は二重登録しないが、その行の「対象商品」への紐付けだけは行う。
    // 一括変換ボタンで選択肢だけ作った後に、同じCSVで紐付けを追加できるようにするため（何度流しても同じ結果になる）。
    const seen = new Set<string>();
    const forImport = validOptionRows.map((item) => {
      const exists = item.dupKey !== null && (seen.has(item.dupKey) || existingKeys.has(item.dupKey));
      if (item.dupKey !== null) seen.add(item.dupKey);
      if (!exists) return { rowNumber: item.rowNumber, data: item.data };
      skipped += 1;
      return { rowNumber: item.rowNumber, data: { ...item.data, optionName: '' } };
    });
    const r = await importOptionGroups(supabase, ctx, storeId as string, forImport);
    inserted = r.inserted;
    updated = r.linked;
    failed.push(...r.failed);
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
    p_after: { inserted, updated, skipped, failed: failed.length, total_rows: rows.length },
    p_note: null,
  });

  revalidatePath(IMPORT_TYPE_LIST_PATH[type]);
  revalidatePath('/app/settings/import');

  return { inserted, updated, skipped, failed };
}

/**
 * 選択肢グループの取込（セットの中身: カレーを選ぶ／ご飯かナン／ドリンクを選ぶ）。
 * 1行 = 1選択肢。同じグループ名の行はまとめて1グループにする（店舗に同名グループがあればそれを使う）。
 * - グループの必須・最小・最大は、そのグループの行で最初に指定があった値。無ければ 必須・1〜1
 * - 「対象商品」に書かれた商品名（同一店舗）にグループを紐付ける。未紐付けの商品だけ追加する
 * - 見つからない商品名は失敗として返す（選択肢自体は登録する）
 * 戻り値: inserted=登録した選択肢数, linked=新しく紐付けた商品数
 */
async function importOptionGroups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: Ctx,
  storeId: string,
  rows: { rowNumber: number; data: NormalizedOptionGroupRow }[]
): Promise<{ inserted: number; linked: number; failed: { rowNumber: number; reason: string }[] }> {
  const failed: { rowNumber: number; reason: string }[] = [];
  if (rows.length === 0) return { inserted: 0, linked: 0, failed };

  // グループ名ごとにまとめる（表記そのまま。照合は小文字）
  const byGroup = new Map<string, { name: string; rows: typeof rows }>();
  for (const r of rows) {
    const k = r.data.groupName.toLowerCase();
    const g = byGroup.get(k) ?? { name: r.data.groupName, rows: [] };
    g.rows.push(r);
    byGroup.set(k, g);
  }

  const { data: existingGroups } = await supabase
    .from('menu_option_groups')
    .select('id, name')
    .eq('store_id', storeId)
    .eq('status', 'active');
  const groupIdByName = new Map<string, string>(
    ((existingGroups ?? []) as { id: string; name: string }[]).map((g) => [g.name.trim().toLowerCase(), g.id])
  );

  // 無いグループを作る
  let sortBase = groupIdByName.size;
  for (const [key, g] of byGroup) {
    if (groupIdByName.has(key)) continue;
    const spec = g.rows.find((r) => r.data.isRequired !== null || r.data.minSelect !== null || r.data.maxSelect !== null)?.data;
    // 必須=いいえ なら最小は0（未指定のまま1にすると「任意」と表示しつつ選択を強制してしまう）。
    // 最大は1以上でなければDBの制約（max_select >= 1）に反するため下限を1にする。
    const isRequired = spec?.isRequired ?? true;
    const min = Math.max(0, spec?.minSelect ?? (isRequired ? 1 : 0));
    const max = Math.max(min, spec?.maxSelect ?? 1, 1);
    const { data: created, error } = await supabase
      .from('menu_option_groups')
      .insert({
        organization_id: ctx.organizationId,
        store_id: storeId,
        name: g.name,
        is_required: isRequired,
        min_select: min,
        max_select: max,
        sort_order: sortBase++,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error || !created) {
      for (const r of g.rows) failed.push({ rowNumber: r.rowNumber, reason: `グループの作成に失敗しました: ${error?.message ?? ''}` });
      continue;
    }
    groupIdByName.set(key, created.id as string);
  }

  // 選択肢を登録（登録済み分は呼び出し側で optionName を空にして「紐付けだけの行」にしてある。sort_order は既存件数の続き）
  let inserted = 0;
  const optionRows: Record<string, unknown>[] = [];
  const countByGroup = new Map<string, number>();
  for (const [key, g] of byGroup) {
    const groupId = groupIdByName.get(key);
    if (!groupId) continue;
    const { count } = await supabase
      .from('menu_option_items')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('status', 'active');
    countByGroup.set(key, count ?? 0);
    for (const r of g.rows) {
      if (!r.data.optionName) continue; // 紐付けだけの行
      const n = countByGroup.get(key) ?? 0;
      countByGroup.set(key, n + 1);
      optionRows.push({
        organization_id: ctx.organizationId,
        store_id: storeId,
        group_id: groupId,
        name: r.data.optionName,
        name_en: r.data.optionNameEn,
        price: Math.round(r.data.price),
        sort_order: n,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      });
    }
  }
  if (optionRows.length > 0) {
    const { error } = await supabase.from('menu_option_items').insert(optionRows);
    if (error) {
      for (const r of rows) failed.push({ rowNumber: r.rowNumber, reason: `選択肢の登録に失敗しました: ${error.message}` });
      return { inserted: 0, linked: 0, failed };
    }
    inserted = optionRows.length;
  }

  // 対象商品へ紐付け
  const wanted = new Map<string, { groupKey: string; itemName: string; rowNumber: number }>();
  for (const [key, g] of byGroup) {
    for (const r of g.rows) {
      for (const itemName of r.data.targetItems) {
        const k = `${key}|${itemName.toLowerCase()}`;
        if (!wanted.has(k)) wanted.set(k, { groupKey: key, itemName, rowNumber: r.rowNumber });
      }
    }
  }
  let linked = 0;
  if (wanted.size > 0) {
    // 商品名は大文字小文字・前後の空白の違いを無視して突き合わせるため、店舗の商品を全件引いてから照合する。
    // （.in('name', ...) はCSVの表記ゆれで一致せず「対象商品が見つかりません」になってしまう）
    const { data: items } = await supabase
      .from('menu_items')
      .select('id, name')
      .eq('store_id', storeId)
      .neq('status', 'deleted');
    // 同じ商品名がカテゴリ違いで複数ある場合は、その全部に選択肢グループを付ける
    const itemIdsByName = new Map<string, string[]>();
    for (const i of (items ?? []) as { id: string; name: string }[]) {
      const k = i.name.trim().toLowerCase();
      itemIdsByName.set(k, [...(itemIdsByName.get(k) ?? []), i.id]);
    }
    const { data: links } = await supabase
      .from('menu_item_option_groups')
      .select('menu_item_id, group_id')
      .eq('store_id', storeId);
    const linkSet = new Set(((links ?? []) as { menu_item_id: string; group_id: string }[]).map((l) => `${l.group_id}|${l.menu_item_id}`));

    const linkRows: Record<string, unknown>[] = [];
    for (const w of wanted.values()) {
      const groupId = groupIdByName.get(w.groupKey);
      const itemIds = itemIdsByName.get(w.itemName.trim().toLowerCase()) ?? [];
      if (!groupId) continue;
      if (itemIds.length === 0) {
        failed.push({ rowNumber: w.rowNumber, reason: `対象商品が見つかりません: ${w.itemName}` });
        continue;
      }
      for (const itemId of itemIds) {
        if (linkSet.has(`${groupId}|${itemId}`)) continue;
        linkSet.add(`${groupId}|${itemId}`);
        linkRows.push({
          organization_id: ctx.organizationId,
          store_id: storeId,
          menu_item_id: itemId,
          group_id: groupId,
          sort_order: 0,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        });
      }
    }
    if (linkRows.length > 0) {
      const { error } = await supabase.from('menu_item_option_groups').insert(linkRows);
      if (error) failed.push({ rowNumber: 0, reason: `商品への紐付けに失敗しました: ${error.message}` });
      else linked = linkRows.length;
    }
  }

  revalidatePath('/app/settings/options');
  revalidatePath('/app/pos');
  return { inserted, linked, failed };
}
