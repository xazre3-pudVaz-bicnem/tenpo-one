'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { purchaseToStockQty, purchaseToStockUnitCost } from '@/lib/units';
import { isPriceIncreaseSignificant } from '@/lib/metrics';
import { movementNeedsReason, type ItemKind, type ManualMovementType, type MovementType } from '@/components/inventory/labels';

const LIST_PATH = '/app/inventory';
const countPath = (id: string) => `/app/inventory/counts/${id}`;

/** stock_transfers RPC（ship/receive）のエラーコードを日本語メッセージへ変換する */
function mapTransferError(message: string): string {
  if (message.startsWith('INSUFFICIENT_STOCK')) {
    const name = message.split(':').slice(1).join(':').trim();
    return `在庫が不足しています: ${name}`;
  }
  if (message.includes('INVALID_STATUS')) return 'この状態では操作できません（画面を更新してご確認ください）';
  if (message.includes('FORBIDDEN')) return 'この操作を行う権限がありません';
  if (message.includes('TRANSFER_NOT_FOUND')) return '移動が見つかりません';
  return '処理に失敗しました。時間をおいて再度お試しください';
}

/** 品目の新規追加 */
export async function createItem(input: {
  storeId: string;
  name: string;
  itemKind: ItemKind;
  category: string | null;
  unit: string;
  initialQuantity: number;
  reorderPoint: number | null;
  minQuantity: number | null;
  optimalQuantity: number | null;
  avgCost: number | null;
  purchaseUnit: string | null;
  purchaseToStockFactor: number;
}) {
  const ctx = await requirePermission('inventory.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  if (!input.name.trim()) throw new Error('名前を入力してください');
  if (!(input.purchaseToStockFactor > 0)) throw new Error('変換係数は正の数で指定してください');
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
    min_quantity: input.minQuantity,
    optimal_quantity: input.optimalQuantity,
    avg_cost: input.avgCost,
    purchase_unit: input.purchaseUnit,
    purchase_to_stock_factor: input.purchaseToStockFactor,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(LIST_PATH);
}

/** 品目の編集（発注点・最低在庫・適正在庫・仕入単位/変換係数などの属性のみ。数量・原価は入出庫/入荷から更新する） */
export async function updateItem(
  itemId: string,
  input: {
    name: string;
    itemKind: ItemKind;
    category: string | null;
    unit: string;
    reorderPoint: number | null;
    minQuantity: number | null;
    optimalQuantity: number | null;
    purchaseUnit: string | null;
    purchaseToStockFactor: number;
  }
) {
  const ctx = await requirePermission('inventory.write');
  if (!input.name.trim()) throw new Error('名前を入力してください');
  if (!(input.purchaseToStockFactor > 0)) throw new Error('変換係数は正の数で指定してください');
  const supabase = await createClient();
  const { error } = await supabase
    .from('inventory_items')
    .update({
      name: input.name.trim(),
      item_kind: input.itemKind,
      category: input.category,
      unit: input.unit || '個',
      reorder_point: input.reorderPoint,
      min_quantity: input.minQuantity,
      optimal_quantity: input.optimalQuantity,
      purchase_unit: input.purchaseUnit,
      purchase_to_stock_factor: input.purchaseToStockFactor,
      updated_by: ctx.userId,
    })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(LIST_PATH);
}

/**
 * 手動の入出庫登録。
 * in（入荷）は加重平均仕入単価の一貫性のため、必ず rpc apply_stock_receipt を使う。
 * out/waste/count_adjust は減少（負のquantity）として直接記録する。
 */
export async function addMovement(input: {
  itemId: string;
  movementType: ManualMovementType;
  quantity: number;
  reason: string | null;
  unitCost?: number | null;
}) {
  const ctx = await requirePermission('inventory.write');
  if (input.quantity <= 0) throw new Error('数量は正の値で入力してください');
  if (movementNeedsReason(input.movementType) && !input.reason?.trim()) {
    throw new Error('理由を入力してください');
  }
  const supabase = await createClient();
  const { data: item, error } = await supabase.from('inventory_items').select('*').eq('id', input.itemId).single();
  if (error || !item) throw new Error('品目が見つかりません');

  if (input.movementType === 'in') {
    // 入力値は「仕入単位」（品目に仕入単位が未設定なら係数1=在庫単位と同一）とみなし、
    // lib/units の変換関数で在庫単位の数量・単価に変換してから apply_stock_receipt を呼ぶ
    const factor = Number(item.purchase_to_stock_factor) > 0 ? Number(item.purchase_to_stock_factor) : 1;
    const purchaseUnitCost =
      input.unitCost != null && input.unitCost >= 0
        ? input.unitCost
        : (item.avg_cost ?? item.last_purchase_cost ?? 0);
    const stockQuantity = purchaseToStockQty(input.quantity, factor);
    const stockUnitCost = purchaseToStockUnitCost(purchaseUnitCost, factor);

    const { error: rpcErr } = await supabase.rpc('apply_stock_receipt', {
      p_inventory_item_id: input.itemId,
      p_quantity: stockQuantity,
      p_unit_cost: stockUnitCost,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId,
      p_store: item.store_id,
      p_action: 'inventory.receive',
      p_target_table: 'inventory_items',
      p_target_id: input.itemId,
      p_before: { current_quantity: item.current_quantity, avg_cost: item.avg_cost },
      p_after: { quantity_added: stockQuantity, unit_cost: stockUnitCost },
      p_note: input.reason,
    });

    revalidatePath(LIST_PATH);
    return;
  }

  const signedQuantity = -input.quantity;

  if (input.movementType === 'out' || input.movementType === 'waste') {
    const { data: settings } = await supabase
      .from('store_settings')
      .select('allow_negative_stock')
      .eq('store_id', item.store_id)
      .maybeSingle();
    const allowNegative = settings?.allow_negative_stock ?? true;
    if (!allowNegative && Number(item.current_quantity) + signedQuantity < 0) {
      throw new Error(`在庫が不足しています: ${item.name}`);
    }
  }

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

  if (movementNeedsReason(input.movementType)) {
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

/**
 * 店舗間移動。rpc apply_stock_transfer を使う（出庫/入庫の2行を対で記録・受け側品目は自動作成されうる）。
 * RPC側の権限チェック（store_manager以上）に合わせて vendors.manage で権限判定する。
 */
export async function transferStock(input: {
  fromItemId: string;
  toStoreId: string;
  quantity: number;
  reason: string | null;
}) {
  const ctx = await requirePermission('vendors.manage');
  if (input.quantity <= 0) throw new Error('数量は正の値で入力してください');
  if (!input.toStoreId) throw new Error('移動先店舗を選択してください');
  if (!ctx.stores.some((s) => s.id === input.toStoreId)) {
    throw new Error('移動先店舗にアクセス権がありません');
  }
  const supabase = await createClient();
  const { data: fromItem } = await supabase
    .from('inventory_items')
    .select('id, store_id')
    .eq('id', input.fromItemId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!fromItem || !ctx.stores.some((s) => s.id === fromItem.store_id)) {
    throw new Error('移動元の品目が見つかりません');
  }
  const { data, error } = await supabase.rpc('apply_stock_transfer', {
    p_from_item_id: input.fromItemId,
    p_to_store_id: input.toStoreId,
    p_quantity: input.quantity,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath(LIST_PATH);
  return data as { ok: boolean; transfer_group_id: string; to_item_id: string };
}

/**
 * 店舗間移動ワークフロー（申請→発送→受取）。
 * 申請: 自店（from）から他店（to）への移動をstock_transfers + stock_transfer_itemsとして起票する。
 * 在庫は発送（ship_stock_transfer）まで動かない。
 */
export async function requestStockTransfer(input: {
  fromStoreId: string;
  toStoreId: string;
  note: string | null;
  lines: { inventoryItemId: string; quantity: number }[];
}): Promise<string> {
  const ctx = await requirePermission('vendors.manage');
  if (!input.toStoreId) throw new Error('移動先店舗を選択してください');
  if (input.toStoreId === input.fromStoreId) throw new Error('自店舗には移動できません');
  const lines = input.lines.filter((l) => l.inventoryItemId && l.quantity > 0);
  if (lines.length === 0) throw new Error('品目を1件以上選択してください');

  const supabase = await createClient();
  const ids = [...new Set(lines.map((l) => l.inventoryItemId))];
  const { data: items, error: itemsErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit, store_id')
    .in('id', ids);
  if (itemsErr || !items) throw new Error('品目の取得に失敗しました');
  const itemMap = new Map(items.map((i) => [i.id as string, i]));
  for (const l of lines) {
    const item = itemMap.get(l.inventoryItemId);
    if (!item || item.store_id !== input.fromStoreId) throw new Error('選択した品目が自店舗に見つかりません');
  }

  const { data: transfer, error } = await supabase
    .from('stock_transfers')
    .insert({
      organization_id: ctx.organizationId,
      from_store_id: input.fromStoreId,
      to_store_id: input.toStoreId,
      status: 'requested',
      note: input.note,
      requested_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !transfer) throw new Error(error?.message ?? '移動申請の作成に失敗しました');

  const { error: linesErr } = await supabase.from('stock_transfer_items').insert(
    lines.map((l) => {
      const item = itemMap.get(l.inventoryItemId)!;
      return {
        transfer_id: transfer.id,
        inventory_item_id: l.inventoryItemId,
        name: item.name as string,
        quantity: l.quantity,
        unit: item.unit as string,
      };
    })
  );
  if (linesErr) throw new Error(linesErr.message);

  revalidatePath(LIST_PATH);
  return transfer.id as string;
}

/** 発送: rpc ship_stock_transfer（送り元在庫を減算。負在庫禁止設定を尊重） */
export async function shipStockTransfer(transferId: string) {
  const ctx = await requirePermission('vendors.manage');
  const supabase = await createClient();
  const { data: transfer } = await supabase
    .from('stock_transfers')
    .select('id, organization_id, from_store_id')
    .eq('id', transferId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!transfer || !ctx.stores.some((s) => s.id === transfer.from_store_id)) {
    throw new Error('移動が見つかりません');
  }
  const { error } = await supabase.rpc('ship_stock_transfer', { p_transfer_id: transferId });
  if (error) throw new Error(mapTransferError(error.message));
  revalidatePath(LIST_PATH);
}

/** 受取: rpc receive_stock_transfer（受取店の在庫を加算。同名品目がなければ自動作成） */
export async function receiveStockTransfer(transferId: string) {
  const ctx = await requirePermission('vendors.manage');
  const supabase = await createClient();
  const { data: transfer } = await supabase
    .from('stock_transfers')
    .select('id, organization_id, to_store_id')
    .eq('id', transferId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!transfer || !ctx.stores.some((s) => s.id === transfer.to_store_id)) {
    throw new Error('移動が見つかりません');
  }
  const { error } = await supabase.rpc('receive_stock_transfer', { p_transfer_id: transferId });
  if (error) throw new Error(mapTransferError(error.message));
  revalidatePath(LIST_PATH);
}

/** 取消（申請中のみ・理由必須・監査ログ） */
export async function cancelStockTransfer(transferId: string, reason: string) {
  const ctx = await requirePermission('vendors.manage');
  if (!reason.trim()) throw new Error('理由を入力してください');
  const supabase = await createClient();
  const { data: transfer, error } = await supabase
    .from('stock_transfers')
    .select('id, organization_id, from_store_id, status')
    .eq('id', transferId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (error || !transfer) throw new Error('移動が見つかりません');
  if (transfer.status !== 'requested') throw new Error('申請中の移動のみ取消できます');

  const { error: updErr } = await supabase
    .from('stock_transfers')
    .update({ status: 'cancelled', updated_by: ctx.userId })
    .eq('id', transferId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: transfer.from_store_id,
    p_action: 'inventory.transfer.cancel',
    p_target_table: 'stock_transfers',
    p_target_id: transferId,
    p_before: { status: 'requested' },
    p_after: { status: 'cancelled' },
    p_note: reason,
  });

  revalidatePath(LIST_PATH);
}

export async function getMovementHistory(itemId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from('stock_movements')
    .select('id, movement_type, quantity, reason, occurred_at, to_store_id')
    .eq('inventory_item_id', itemId)
    .order('occurred_at', { ascending: false })
    .limit(50);
  const rows = data ?? [];

  const storeIds = [...new Set(rows.map((r) => r.to_store_id).filter((v): v is string => !!v))];
  let storeNames = new Map<string, string>();
  if (storeIds.length > 0) {
    const { data: stores } = await supabase.from('stores').select('id, name').in('id', storeIds);
    storeNames = new Map((stores ?? []).map((s) => [s.id as string, s.name as string]));
  }

  return rows.map((r) => ({
    id: r.id as string,
    movementType: r.movement_type as MovementType,
    quantity: Number(r.quantity),
    reason: r.reason as string | null,
    occurredAt: r.occurred_at as string,
    toStoreName: r.to_store_id ? (storeNames.get(r.to_store_id) ?? null) : null,
  }));
}

export interface PurchaseHistoryRow {
  id: string;
  businessDate: string;
  vendorName: string | null;
  unitCost: number | null;
  quantity: number;
}

export interface PurchaseHistoryResult {
  unit: string;
  /** 現在平均単価（inventory_items.avg_cost。加重平均・apply_stock_receiptが更新） */
  currentAvgCost: number | null;
  /** 前回仕入単価（直近の入荷） */
  previousUnitCost: number | null;
  /** 前々回仕入単価 */
  priorUnitCost: number | null;
  /** 前回比の変化率（%）。前々回が無い/0以下なら null */
  changeRatePct: number | null;
  /** isPriceIncreaseSignificant(前回, 前々回) 既定10%以上の値上がり */
  isSignificantIncrease: boolean;
  rows: PurchaseHistoryRow[];
}

/**
 * 品目の仕入価格履歴（直近30件の入荷）。仕入先は stock_movements.ref_purchase_order_id →
 * purchase_orders.vendor_id → vendors.name で解決する（発注書経由の入荷のみ判明。手動入荷はnull）。
 */
export async function getPurchaseHistory(itemId: string): Promise<PurchaseHistoryResult> {
  await requireMember();
  const supabase = await createClient();

  const { data: item } = await supabase.from('inventory_items').select('unit, avg_cost').eq('id', itemId).single();

  const { data: movementsData } = await supabase
    .from('stock_movements')
    .select('id, quantity, unit_cost, business_date, occurred_at, ref_purchase_order_id')
    .eq('inventory_item_id', itemId)
    .eq('movement_type', 'in')
    .order('occurred_at', { ascending: false })
    .limit(30);
  const movements = movementsData ?? [];

  const poIds = [...new Set(movements.map((m) => m.ref_purchase_order_id).filter((v): v is string => !!v))];
  let vendorNameByPoId = new Map<string, string>();
  if (poIds.length > 0) {
    const { data: pos } = await supabase.from('purchase_orders').select('id, vendor_id').in('id', poIds);
    const vendorIds = [...new Set((pos ?? []).map((p) => p.vendor_id).filter((v): v is string => !!v))];
    let vendorNameById = new Map<string, string>();
    if (vendorIds.length > 0) {
      const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', vendorIds);
      vendorNameById = new Map((vendors ?? []).map((v) => [v.id as string, v.name as string]));
    }
    vendorNameByPoId = new Map(
      (pos ?? [])
        .filter((p) => p.vendor_id)
        .map((p) => [p.id as string, vendorNameById.get(p.vendor_id as string) ?? '不明な仕入先'])
    );
  }

  const rows: PurchaseHistoryRow[] = movements.map((m) => ({
    id: m.id as string,
    businessDate: m.business_date as string,
    vendorName: m.ref_purchase_order_id ? (vendorNameByPoId.get(m.ref_purchase_order_id as string) ?? null) : null,
    unitCost: m.unit_cost as number | null,
    quantity: Number(m.quantity),
  }));

  const previousUnitCost = rows[0]?.unitCost ?? null;
  const priorUnitCost = rows[1]?.unitCost ?? null;
  const changeRatePct =
    previousUnitCost != null && priorUnitCost != null && priorUnitCost > 0
      ? ((previousUnitCost - priorUnitCost) / priorUnitCost) * 100
      : null;

  return {
    unit: (item?.unit as string) ?? '',
    currentAvgCost: item?.avg_cost ?? null,
    previousUnitCost,
    priorUnitCost,
    changeRatePct,
    isSignificantIncrease: isPriceIncreaseSignificant(previousUnitCost ?? 0, priorUnitCost),
    rows,
  };
}

/** 棚卸を開始: 対象店舗の全active品目の現在庫をスナップショットする */
export async function startCount(storeId: string): Promise<string> {
  const ctx = await requirePermission('inventory.write');
  if (!ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
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
