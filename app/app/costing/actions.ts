'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

const LIST_PATH = '/app/costing';
const detailPath = (menuItemId: string) => `/app/costing/${menuItemId}`;

function isUniqueViolation(message: string) {
  return /duplicate key|unique constraint/i.test(message);
}

/**
 * レシピ食材行の追加。
 * menu_item_ingredients は unique(menu_item_id, inventory_item_id) 制約あり。
 * 販売時の理論在庫減算は 00010 の finalize_order が自動で行うため、ここでは行わない。
 */
export async function addRecipeLine(input: {
  menuItemId: string;
  inventoryItemId: string;
  quantity: number;
  note: string | null;
}): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!input.inventoryItemId) return { error: '食材を選択してください' };
  if (!(input.quantity > 0)) return { error: '使用量は0より大きい値で入力してください' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('menu_item_ingredients')
    .insert({
      organization_id: ctx.organizationId,
      menu_item_id: input.menuItemId,
      inventory_item_id: input.inventoryItemId,
      quantity: input.quantity,
      note: input.note,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error && isUniqueViolation(error.message)) return { error: 'この食材はすでにレシピに追加されています' };
    return { error: `追加に失敗しました: ${error?.message ?? ''}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'costing.recipe_line.create',
    p_target_table: 'menu_item_ingredients',
    p_target_id: data.id as string,
    p_before: null,
    p_after: { menu_item_id: input.menuItemId, inventory_item_id: input.inventoryItemId, quantity: input.quantity },
    p_note: null,
  });

  revalidatePath(detailPath(input.menuItemId));
  revalidatePath(LIST_PATH);
  return {};
}

/** レシピ食材行の更新（食材・使用量・メモ） */
export async function updateRecipeLine(
  lineId: string,
  input: { menuItemId: string; inventoryItemId: string; quantity: number; note: string | null }
): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!input.inventoryItemId) return { error: '食材を選択してください' };
  if (!(input.quantity > 0)) return { error: '使用量は0より大きい値で入力してください' };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('menu_item_ingredients')
    .select('inventory_item_id, quantity, note')
    .eq('id', lineId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const { error } = await supabase
    .from('menu_item_ingredients')
    .update({
      inventory_item_id: input.inventoryItemId,
      quantity: input.quantity,
      note: input.note,
      updated_by: ctx.userId,
    })
    .eq('id', lineId)
    .eq('organization_id', ctx.organizationId);
  if (error) {
    if (isUniqueViolation(error.message)) return { error: 'この食材はすでにレシピに追加されています' };
    return { error: `更新に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'costing.recipe_line.update',
    p_target_table: 'menu_item_ingredients',
    p_target_id: lineId,
    p_before: before ?? null,
    p_after: { inventory_item_id: input.inventoryItemId, quantity: input.quantity, note: input.note },
    p_note: null,
  });

  revalidatePath(detailPath(input.menuItemId));
  revalidatePath(LIST_PATH);
  return {};
}

/** レシピ食材行の削除 */
export async function deleteRecipeLine(lineId: string, menuItemId: string): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('menu_item_ingredients')
    .select('inventory_item_id, quantity, note')
    .eq('id', lineId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const { error } = await supabase
    .from('menu_item_ingredients')
    .delete()
    .eq('id', lineId)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'costing.recipe_line.delete',
    p_target_table: 'menu_item_ingredients',
    p_target_id: lineId,
    p_before: before ?? null,
    p_after: null,
    p_note: null,
  });

  revalidatePath(detailPath(menuItemId));
  revalidatePath(LIST_PATH);
  return {};
}
