'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import type { ItemKind, ManualMovementType, MovementType } from '@/components/inventory/labels';

const LIST_PATH = '/app/inventory';
const countPath = (id: string) => `/app/inventory/counts/${id}`;

/** 品目の新規追加 */
export async function createItem(input: {
  storeId: string;
  name: string;
  itemKind: ItemKind;
  category: string | null;
  unit: string;
  initialQuantity: number;
  reorderPoint: number | null;
  avgCost: number | null;
}) {
  const ctx = await requirePermission('inventory.write');
  if (!input.name.trim()) throw new Error('名前を入力してください');
  const supabase = await createClient();
  const { error } = await supabase.from('inventory_items').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    name: input.name.trim(),
    item_kind: input.itemKind,
    category: input.category,
    unit: input.unit || '個',
    current_quantity: input.initialQuantity,
    reorder_point: input.reorderPoint,
    avg_cost: input.avgCost,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(LIST_PATH);
}

/** 手動の入出庫登録。out/waste/count_adjustは減少（負のquantity）として記録する */
export async function addMovement(input: {
  itemId: string;
  movementType: ManualMovementType;
  quantity: number;
  reason: string | null;
}) {
  const ctx = await requirePermission('inventory.write');
  if (input.quantity <= 0) throw new Error('数量は正の値で入力してください');
  if ((input.movementType === 'waste' || input.movementType === 'count_adjust') && !input.reason?.trim()) {
    throw new Error('理由を入力してください');
  }
  const supabase = await createClient();
  const { data: item, error } = await supabase.from('inventory_items').select('*').eq('id', input.itemId).single();
  if (error || !item) throw new Error('品目が見つかりません');

  const signedQuantity = input.movementType === 'in' ? input.quantity : -input.quantity;

  const { error: moveErr } = await supabase.from('stock_movements').insert({
    organization_id: ctx.organizationId,
    store_id: item.store_id,
    inventory_item_id: input.itemId,
    movement_type: input.movementType,
    quantity: signedQuantity,
    unit_cost: item.avg_cost,
    reason: input.reason,
    created_by: ctx.userId,
  });
  if (moveErr) throw new Error(moveErr.message);

  const newQty = Number(item.current_quantity) + signedQuantity;
  const { error: updErr } = await supabase
    .from('inventory_items')
    .update({ current_quantity: newQty, updated_by: ctx.userId })
    .eq('id', input.itemId);
  if (updErr) throw new Error(updErr.message);

  if (input.movementType === 'waste' || input.movementType === 'count_adjust') {
    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId,
      p_store: item.store_id,
      p_action: `inventory.${input.movementType}`,
      p_target_table: 'inventory_items',
      p_target_id: input.itemId,
      p_before: { current_quantity: item.current_quantity },
      p_after: { current_quantity: newQty },
      p_note: input.reason,
    });
  }

  revalidatePath(LIST_PATH);
}

export async function getMovementHistory(itemId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from('stock_movements')
    .select('id, movement_type, quantity, reason, occurred_at')
    .eq('inventory_item_id', itemId)
    .order('occurred_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    movementType: r.movement_type as MovementType,
    quantity: Number(r.quantity),
    reason: r.reason as string | null,
    occurredAt: r.occurred_at as string,
  }));
}

/** 棚卸を開始: 対象店舗の全active品目の現在庫をスナップショットする */
export async function startCount(storeId: string): Promise<string> {
  const ctx = await requirePermission('inventory.write');
  const supabase = await createClient();
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, current_quantity')
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', storeId)
    .eq('status', 'active');
  if (!items || items.length === 0) throw new Error('対象品目がありません');

  const { data: count, error } = await supabase
    .from('stock_counts')
    .insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      count_date: todayJst(),
      status: 'draft',
      counted_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !count) throw new Error(error?.message ?? '棚卸の開始に失敗しました');

  const { error: itemsErr } = await supabase.from('stock_count_items').insert(
    items.map((i) => ({
      stock_count_id: count.id,
      inventory_item_id: i.id,
      expected_quantity: i.current_quantity,
    }))
  );
  if (itemsErr) throw new Error(itemsErr.message);

  revalidatePath(LIST_PATH);
  return count.id as string;
}

/** 棚卸の実数入力を一括保存（差異を計算） */
export async function saveCounts(countId: string, entries: { id: string; countedQuantity: number }[]) {
  await requirePermission('inventory.write');
  const supabase = await createClient();
  const { data: count, error } = await supabase.from('stock_counts').select('id, status').eq('id', countId).single();
  if (error || !count) throw new Error('棚卸が見つかりません');
  if (count.status !== 'draft') throw new Error('この棚卸は編集できません');

  const { data: items } = await supabase
    .from('stock_count_items')
    .select('id, expected_quantity')
    .eq('stock_count_id', countId);
  const expectedMap = new Map((items ?? []).map((i) => [i.id as string, Number(i.expected_quantity)]));

  for (const e of entries) {
    const expected = expectedMap.get(e.id);
    if (expected == null) continue;
    await supabase
      .from('stock_count_items')
      .update({ counted_quantity: e.countedQuantity, difference: e.countedQuantity - expected })
      .eq('id', e.id);
  }

  revalidatePath(countPath(countId));
}

/** 棚卸を確定: 差異のある品目をstock_movements(count_adjust)として記録し、在庫数量を実数へ更新する */
export async function finalizeCount(countId: string) {
  const ctx = await requirePermission('inventory.write');
  const supabase = await createClient();
  const { data: count, error } = await supabase.from('stock_counts').select('*').eq('id', countId).single();
  if (error || !count) throw new Error('棚卸が見つかりません');
  if (count.status !== 'draft') throw new Error('この棚卸はすでに確定しています');

  const { data: items, error: itemsErr } = await supabase
    .from('stock_count_items')
    .select('*')
    .eq('stock_count_id', countId);
  if (itemsErr || !items) throw new Error('明細の取得に失敗しました');

  for (const item of items) {
    if (item.counted_quantity == null) continue;
    const diff = Number(item.counted_quantity) - Number(item.expected_quantity);
    if (diff !== 0) {
      await supabase.from('stock_movements').insert({
        organization_id: ctx.organizationId,
        store_id: count.store_id,
        inventory_item_id: item.inventory_item_id,
        movement_type: 'count_adjust',
        quantity: diff,
        reason: '棚卸差異調整',
        ref_stock_count_id: countId,
        created_by: ctx.userId,
      });
    }
    await supabase
      .from('inventory_items')
      .update({ current_quantity: item.counted_quantity, updated_by: ctx.userId })
      .eq('id', item.inventory_item_id);
  }

  const { error: updErr } = await supabase
    .from('stock_counts')
    .update({ status: 'completed', updated_by: ctx.userId })
    .eq('id', countId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: count.store_id,
    p_action: 'stock_count.finalize',
    p_target_table: 'stock_counts',
    p_target_id: countId,
    p_before: { status: 'draft' },
    p_after: { status: 'completed' },
    p_note: null,
  });

  revalidatePath(LIST_PATH);
  revalidatePath(countPath(countId));
}
