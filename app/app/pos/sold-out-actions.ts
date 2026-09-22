'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 品切れ（売切）の切り替え（2026-09-21 店舗要望）。ハンディ・レジのスタッフ全員（pos.order）が使える。
 *
 * menu_items の更新は RLS で店長以上に限られているため、ここで「企業・店舗・権限」を確かめたうえで
 * サービスロールで is_sold_out（と更新者）だけを書き換える（価格・名前など他の列は触らない）。
 * 全店共通の商品（store_id が空）は全店に効くので、店長以上（menu.manage）だけが通常の権限（RLS）で書き換える。
 * 切り替えは監査ログに残す。
 */
export async function setItemSoldOut(itemId: string, soldOut: boolean): Promise<{ error?: string }> {
  const ctx = await requirePermission('pos.order');
  if (typeof itemId !== 'string' || !UUID.test(itemId) || typeof soldOut !== 'boolean') {
    return { error: '商品の指定が正しくありません' };
  }

  const admin = createAdminClient();
  const { data: item, error: readError } = await admin
    .from('menu_items')
    .select('id, organization_id, store_id, name, is_sold_out, status')
    .eq('id', itemId)
    .maybeSingle();
  if (readError) return { error: `商品の読み込みに失敗しました: ${readError.message}` };
  if (!item || item.organization_id !== ctx.organizationId || item.status === 'deleted') {
    return { error: '商品が見つかりません。画面を開き直してください' };
  }

  const supabase = await createClient();
  if (item.store_id === null) {
    if (!can(ctx.role, 'menu.manage')) {
      return { error: '全店共通の商品は、店長以上がメニュー編集で売切にしてください' };
    }
    const { error } = await supabase
      .from('menu_items')
      .update({ is_sold_out: soldOut, updated_by: ctx.userId })
      .eq('id', itemId)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `更新に失敗しました: ${error.message}` };
  } else {
    if (!ctx.isHq && !ctx.stores.some((s) => s.id === item.store_id)) {
      return { error: 'この店舗の商品は操作できません' };
    }
    const { error } = await admin
      .from('menu_items')
      .update({ is_sold_out: soldOut, updated_by: ctx.userId })
      .eq('id', itemId)
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', item.store_id);
    if (error) return { error: `更新に失敗しました: ${error.message}` };
  }

  if (item.is_sold_out !== soldOut) {
    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId,
      p_store: item.store_id,
      p_action: soldOut ? 'menu_item.sold_out' : 'menu_item.back_on_sale',
      p_target_table: 'menu_items',
      p_target_id: itemId,
      p_before: { is_sold_out: item.is_sold_out },
      p_after: { is_sold_out: soldOut },
      p_note: soldOut ? `売切: ${item.name}` : `販売再開: ${item.name}`,
    });
  }

  revalidatePath('/handy', 'layout');
  revalidatePath('/app/pos', 'layout');
  revalidatePath('/app/settings/menu');
  revalidatePath('/app/settings/plans');
  revalidatePath('/app/settings/categories');
  revalidatePath('/app/settings/menu-book');
  return {};
}
