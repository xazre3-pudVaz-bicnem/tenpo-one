'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const LIST_PATH = '/app/purchases';
const detailPath = (id: string) => `/app/purchases/${id}`;

export interface PoLineInput {
  inventoryItemId: string | null;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

/** 発注書の作成（status='draft'） */
export async function createPurchaseOrder(input: {
  storeId: string;
  vendorId: string;
  expectedAt: string | null;
  note: string | null;
  lines: PoLineInput[];
}): Promise<string> {
  const ctx = await requirePermission('vendors.manage');
  if (!input.vendorId) throw new Error('仕入先を選択してください');
  if (input.lines.length === 0) throw new Error('明細を1件以上入力してください');
  const supabase = await createClient();

  const total = input.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitCost), 0);

  const { data: po, error } = await supabase
    .from('purchase_orders')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      vendor_id: input.vendorId,
      status: 'draft',
      expected_at: input.expectedAt,
      total,
      note: input.note,
      requested_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !po) throw new Error(error?.message ?? '発注書の作成に失敗しました');

  const { error: itemsErr } = await supabase.from('purchase_order_items').insert(
    input.lines.map((l) => ({
      organization_id: ctx.organizationId,
      purchase_order_id: po.id,
      inventory_item_id: l.inventoryItemId,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      unit_cost: l.unitCost,
    }))
  );
  if (itemsErr) throw new Error(itemsErr.message);

  revalidatePath(LIST_PATH);
  return po.id as string;
}

type PoAction = 'request' | 'approve' | 'order';
const PO_TRANSITIONS: Record<PoAction, { from: string[]; to: string }> = {
  request: { from: ['draft'], to: 'requested' },
  approve: { from: ['requested'], to: 'approved' },
  order: { from: ['approved'], to: 'ordered' },
};

/** 発注書の状態遷移（申請・承認・発注確定）。監査ログに記録する */
export async function changePurchaseOrderStatus(poId: string, action: PoAction) {
  const ctx = await requirePermission('vendors.manage');
  const def = PO_TRANSITIONS[action];
  const supabase = await createClient();
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('id, organization_id, store_id, status')
    .eq('id', poId)
    .single();
  if (error || !po) throw new Error('発注書が見つかりません');
  if (!def.from.includes(po.status)) throw new Error('この状態からは操作できません');

  const update: Record<string, unknown> = { status: def.to, updated_by: ctx.userId };
  if (action === 'order') update.ordered_at = new Date().toISOString();
  if (action === 'approve') {
    update.approved_by = ctx.userId;
    update.approved_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase.from('purchase_orders').update(update).eq('id', poId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: po.store_id,
    p_action: `purchase_order.${action}`,
    p_target_table: 'purchase_orders',
    p_target_id: poId,
    p_before: { status: po.status },
    p_after: { status: def.to },
    p_note: null,
  });

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(poId));
}

/** 発注書の取消（理由必須・監査ログ）。入荷済み明細がある場合は取消不可 */
export async function cancelPurchaseOrder(poId: string, reason: string) {
  const ctx = await requirePermission('vendors.manage');
  if (!reason.trim()) throw new Error('理由を入力してください');
  const supabase = await createClient();
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('id, organization_id, store_id, status')
    .eq('id', poId)
    .single();
  if (error || !po) throw new Error('発注書が見つかりません');
  if (!['draft', 'requested', 'approved', 'ordered'].includes(po.status)) {
    throw new Error('この発注書は取消できません');
  }

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('received_quantity')
    .eq('purchase_order_id', poId);
  if ((items ?? []).some((i) => Number(i.received_quantity) > 0)) {
    throw new Error('入荷済みの発注は取消できません');
  }

  const { error: updErr } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled', updated_by: ctx.userId })
    .eq('id', poId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: po.store_id,
    p_action: 'purchase_order.cancel',
    p_target_table: 'purchase_orders',
    p_target_id: poId,
    p_before: { status: po.status },
    p_after: { status: 'cancelled' },
    p_note: reason,
  });

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(poId));
}

/** 入荷登録: received_quantity加算・在庫連動品目は在庫移動記録+在庫数量加算。全量入荷でstatus='received' */
export async function receiveItems(poId: string, receipts: { itemId: string; quantity: number }[]) {
  const ctx = await requirePermission('vendors.manage');
  const supabase = await createClient();
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('id, organization_id, store_id, status')
    .eq('id', poId)
    .single();
  if (error || !po) throw new Error('発注書が見つかりません');
  if (!['ordered', 'partially_received'].includes(po.status)) {
    throw new Error('この発注書は入荷登録できません');
  }

  const { data: items, error: itemsErr } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', poId);
  if (itemsErr || !items) throw new Error('明細の取得に失敗しました');

  const byId = new Map(items.map((i) => [i.id as string, i]));
  const validReceipts = receipts.filter((r) => r.quantity > 0 && byId.has(r.itemId));
  if (validReceipts.length === 0) throw new Error('入荷数量を入力してください');

  for (const r of validReceipts) {
    const item = byId.get(r.itemId)!;
    const newReceived = Number(item.received_quantity) + r.quantity;
    if (newReceived > Number(item.quantity) + 0.0001) {
      throw new Error(`「${item.name}」の入荷数量が発注数量を超えています`);
    }

    const { error: updItemErr } = await supabase
      .from('purchase_order_items')
      .update({ received_quantity: newReceived })
      .eq('id', r.itemId);
    if (updItemErr) throw new Error(updItemErr.message);

    if (item.inventory_item_id) {
      await supabase.from('stock_movements').insert({
        organization_id: ctx.organizationId,
        store_id: po.store_id,
        inventory_item_id: item.inventory_item_id,
        movement_type: 'in',
        quantity: r.quantity,
        unit_cost: item.unit_cost,
        ref_purchase_order_id: poId,
        created_by: ctx.userId,
      });

      const { data: invItem } = await supabase
        .from('inventory_items')
        .select('current_quantity')
        .eq('id', item.inventory_item_id)
        .single();
      if (invItem) {
        await supabase
          .from('inventory_items')
          .update({ current_quantity: Number(invItem.current_quantity) + r.quantity, updated_by: ctx.userId })
          .eq('id', item.inventory_item_id);
      }
    }
  }

  const { data: refreshedItems } = await supabase
    .from('purchase_order_items')
    .select('quantity, received_quantity')
    .eq('purchase_order_id', poId);
  const allReceived = (refreshedItems ?? []).every((i) => Number(i.received_quantity) >= Number(i.quantity) - 0.0001);
  const anyReceived = (refreshedItems ?? []).some((i) => Number(i.received_quantity) > 0);
  const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status;

  const { error: poUpdErr } = await supabase
    .from('purchase_orders')
    .update({ status: newStatus, updated_by: ctx.userId })
    .eq('id', poId);
  if (poUpdErr) throw new Error(poUpdErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: po.store_id,
    p_action: 'purchase_order.receive',
    p_target_table: 'purchase_orders',
    p_target_id: poId,
    p_before: { status: po.status },
    p_after: { status: newStatus, receipts: validReceipts },
    p_note: null,
  });

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(poId));
}
