'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { menuStockLimitsFrom, mergeMenuStockLimits, MENU_STOCK_MAX } from '@/lib/menu-stock';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * メニューの「本日の食数（売り切り）」を決める（2026-09-24 店舗要望）。
 * 数は店舗設定（store_settings.settings.menuStock）に持つ。null を渡すと在庫管理をやめる。
 *
 * 現場のスタッフ（pos.order）が仕込みの数を入れられるよう、店舗設定の書き込みは
 * サービスロールで menuStock だけを差し替える（他の設定は触らない）。品切れ設定と同じ考え方。
 */
export async function setMenuStockLimit(
  storeId: string,
  itemId: string,
  limit: number | null
): Promise<{ error?: string }> {
  const ctx = await requirePermission('pos.order');
  if (typeof storeId !== 'string' || !UUID.test(storeId)) return { error: '店舗の指定が正しくありません' };
  if (typeof itemId !== 'string' || !UUID.test(itemId)) return { error: '商品の指定が正しくありません' };
  if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > MENU_STOCK_MAX)) {
    return { error: `食数は0〜${MENU_STOCK_MAX}で入力してください` };
  }
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) {
    return { error: 'この店舗は操作できません' };
  }

  const admin = createAdminClient();
  const { data: item } = await admin
    .from('menu_items')
    .select('id, organization_id, status')
    .eq('id', itemId)
    .maybeSingle();
  if (!item || item.organization_id !== ctx.organizationId || item.status === 'deleted') {
    return { error: '商品が見つかりません。画面を開き直してください' };
  }

  const { data: existing } = await admin
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const nextLimits = mergeMenuStockLimits(menuStockLimitsFrom(current), { [itemId]: limit });

  const { error } = await admin
    .from('store_settings')
    .upsert(
      {
        organization_id: ctx.organizationId,
        store_id: storeId,
        settings: { ...current, menuStock: nextLimits },
        updated_by: ctx.userId,
      },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `食数の保存に失敗しました: ${error.message}` };

  await admin.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'inventory.menu_stock_update',
    p_target_table: 'menu_items',
    p_target_id: itemId,
    p_before: null,
    p_after: { limit },
    p_note: null,
  });

  revalidatePath('/app/inventory');
  revalidatePath('/app/pos');
  revalidatePath('/handy');
  return {};
}

/**
 * 在庫管理（本日の食数）をまとめて保存する（2026-09-25 店舗要望「レジの在庫管理と同じ画面に」）。
 * 1品ずつ保存すると「登録」を押すたびに何度も通信するため、変えた分だけを1回で書く。
 * limit が null の品は在庫管理をやめる。
 */
export async function setMenuStockLimits(
  storeId: string,
  entries: { itemId: string; limit: number | null }[]
): Promise<{ error?: string; saved?: number }> {
  const ctx = await requirePermission('pos.order');
  if (typeof storeId !== 'string' || !UUID.test(storeId)) return { error: '店舗の指定が正しくありません' };
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { error: 'この店舗は操作できません' };
  if (!Array.isArray(entries) || entries.length === 0) return { saved: 0 };
  if (entries.length > 500) return { error: '一度に保存できるのは500品までです' };

  const patch: Record<string, number | null> = {};
  for (const e of entries) {
    if (typeof e?.itemId !== 'string' || !UUID.test(e.itemId)) return { error: '商品の指定が正しくありません' };
    const limit = e.limit;
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > MENU_STOCK_MAX)) {
      return { error: `食数は0〜${MENU_STOCK_MAX}で入力してください` };
    }
    patch[e.itemId] = limit;
  }

  const admin = createAdminClient();
  const ids = Object.keys(patch);
  const { data: items } = await admin
    .from('menu_items')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .in('id', ids);
  if ((items ?? []).length !== ids.length) {
    return { error: '商品が見つかりません。画面を開き直してください' };
  }

  const { data: existing } = await admin
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const nextLimits = mergeMenuStockLimits(menuStockLimitsFrom(current), patch);

  const { error } = await admin.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, menuStock: nextLimits },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `在庫の保存に失敗しました: ${error.message}` };

  await admin.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'inventory.menu_stock_bulk_update',
    p_target_table: 'menu_items',
    p_target_id: null,
    p_before: null,
    p_after: { changed: ids.length },
    p_note: null,
  });

  revalidatePath('/app/inventory');
  revalidatePath('/app/inventory/menu-stock');
  revalidatePath('/app/pos');
  revalidatePath('/handy', 'layout');
  return { saved: ids.length };
}
