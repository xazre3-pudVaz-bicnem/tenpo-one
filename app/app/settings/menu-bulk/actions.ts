'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { bulkPatchProblem, type BulkPatch } from '@/lib/menu-bulk';

export interface BulkSaveResult {
  error?: string;
  updated?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * メニュー一括編集の保存。変わった行・項目だけを受け取って更新する。
 * この店舗の商品（全店共通の商品を含む）だけを対象にし、1件でも不正なら何も保存しない。
 */
export async function saveMenuBulk(storeId: string, patches: BulkPatch[]): Promise<BulkSaveResult> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  if (!Array.isArray(patches) || patches.length === 0) return { error: '変更がありません' };
  if (patches.length > 2000) return { error: '一度に保存できるのは2000件までです' };

  const ids = patches.map((p) => p.id);
  if (ids.some((id) => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return { error: '商品の指定が正しくありません' };
  }
  for (const p of patches) {
    const problem = bulkPatchProblem(p);
    if (problem) return { error: problem };
  }

  const supabase = await createClient();

  // 対象の商品がこの店舗（または全店共通）のものか
  const { data: items, error: loadError } = await supabase
    .from('menu_items')
    .select('id, name, price, status')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .in('id', ids);
  if (loadError) return { error: `商品の読み込みに失敗しました: ${loadError.message}` };
  if ((items ?? []).length !== ids.length) return { error: '商品が見つかりません。画面を開き直してください' };

  // カテゴリの指定がこの店舗（または全店共通）のものか
  const categoryIds = Array.from(
    new Set(patches.map((p) => p.categoryId).filter((c): c is string => typeof c === 'string'))
  );
  if (categoryIds.some((id) => !UUID.test(id))) return { error: 'カテゴリの指定が正しくありません' };
  if (categoryIds.length > 0) {
    const { data: cats } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .in('id', categoryIds);
    if ((cats ?? []).length !== categoryIds.length) return { error: 'カテゴリが見つかりません。画面を開き直してください' };
  }

  let updated = 0;
  for (const p of patches) {
    const row: Record<string, unknown> = { updated_by: ctx.userId };
    if (p.name !== undefined) row.name = p.name.trim();
    if (p.nameEn !== undefined) row.name_en = p.nameEn.trim() || null;
    if (p.categoryId !== undefined) row.category_id = p.categoryId;
    if (p.itemType !== undefined) {
      row.item_type = p.itemType;
      if (p.itemType !== 'course') row.duration_minutes = null;
    }
    if (p.price !== undefined) {
      row.price = p.price;
      row.price_pending = p.price <= 0;
    }
    if (p.takeoutPrice !== undefined) row.takeout_price = p.takeoutPrice;
    if (p.status !== undefined) row.status = p.status;
    if (p.isSoldOut !== undefined) row.is_sold_out = p.isSoldOut;

    const { error } = await supabase
      .from('menu_items')
      .update(row)
      .eq('id', p.id)
      .eq('organization_id', ctx.organizationId);
    if (error) {
      return { error: `${updated}件保存したあと、失敗しました: ${error.message}（画面を開き直して確認してください）`, updated };
    }
    updated++;
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.menu.bulk_update',
    p_target_table: 'menu_items',
    p_target_id: storeId,
    p_before: null,
    p_after: { items: updated, fields: Array.from(new Set(patches.flatMap((p) => Object.keys(p).filter((k) => k !== 'id')))) },
    p_note: null,
  });

  for (const path of ['/app/settings/menu', '/app/settings/plans', '/app/settings/menu-bulk', '/app/settings/menu-book', '/app/pos', '/app/pos/sold-out']) {
    revalidatePath(path);
  }
  revalidatePath('/handy', 'layout');
  return { updated };
}
