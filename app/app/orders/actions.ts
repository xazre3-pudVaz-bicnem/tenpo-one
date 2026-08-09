'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withErrorCapture } from '@/lib/observability-server';

export type RefundMethod = 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account' | 'other';
export type RefundKind = 'refund' | 'void';

/** 商品単位返金の1明細（refund_order RPC v3の p_items 1要素に対応） */
export interface RefundItemInput {
  orderItemId: string;
  /** 返金数量（元明細の未返金分を超えないこと。超過はRPCがREFUND_ITEM_QTY_EXCEEDEDで拒否） */
  quantity: number;
  /** 返金金額（単価×数量。line_totalベース。超過はREFUND_ITEM_AMOUNT_EXCEEDEDで拒否） */
  amount: number;
  /** true の場合のみRPC内で在庫を戻す（既定false） */
  restock: boolean;
}

/** refund_order RPCの例外コード → 日本語メッセージ */
const REFUND_ERROR_MESSAGES: Record<string, string> = {
  ORDER_NOT_FOUND: '注文が見つかりません',
  ORDER_NOT_PAID: 'この注文は返金・取消ができる状態ではありません',
  FORBIDDEN: 'この操作を行う権限がありません',
  INVALID_AMOUNT: '返金額は1円以上で入力してください',
  INVALID_KIND: '返金区分が不正です',
  REFUND_EXCEEDS_PAID: '返金額が返金可能額（支払済み − 返金済み）を超えています',
  VOID_MUST_BE_FULL: '取消（VOID）は残額全額のみ選択できます。金額を変更せずに実行してください',
  REFUND_ITEM_INVALID: '選択した品目が見つからないか、返金の対象になりません',
  REFUND_ITEM_QTY_EXCEEDED: '選択した数量が、その品目の返金可能な残数量を超えています',
  REFUND_ITEM_AMOUNT_EXCEEDED: '選択した品目の返金額が、返金可能な残額を超えています',
  REFUND_ITEMS_AMOUNT_MISMATCH: '品目ごとの返金額の合計が、返金総額と一致しません。もう一度お試しください',
};

function translateRefundError(message: string): string {
  for (const [code, ja] of Object.entries(REFUND_ERROR_MESSAGES)) {
    if (message.includes(code)) return ja;
  }
  return translateOrderError(message) ?? message;
}

/**
 * 注文の作成・複製で共通して起きうるDBエラー（トリガー由来）の日本語化。
 * 一致しなければ null を返す（呼び出し側は既存の汎用メッセージにフォールバック）。
 */
const ORDER_ERROR_MESSAGES: Record<string, string> = {
  GUEST_COUNT_REQUIRED: '店内飲食の客数は1名以上で入力してください',
};

function translateOrderError(message: string): string | null {
  for (const [code, ja] of Object.entries(ORDER_ERROR_MESSAGES)) {
    if (message.includes(code)) return ja;
  }
  return null;
}

/**
 * 返金・取消（VOID）。RPC refund_order v3 を使用する。
 * items を渡すと商品単位返金（数量・在庫戻しの明細付き）、省略すると金額指定返金になる。
 */
export async function refundOrder(
  orderId: string,
  amount: number,
  method: RefundMethod,
  reason: string,
  kind: RefundKind = 'refund',
  items?: RefundItemInput[]
) {
  const ctx = await requirePermission('pos.refund');
  if (amount <= 0) throw new Error('返金額が不正です');
  if (!reason.trim()) throw new Error('返金理由を入力してください');

  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, organization_id')
    .eq('id', orderId)
    .single();
  if (!order) throw new Error('注文が見つかりません');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) {
    throw new Error('この店舗の操作はできません');
  }

  await withErrorCapture(
    { route: 'orders.refund', organizationId: order.organization_id, storeId: order.store_id, userId: ctx.userId },
    async () => {
      const { data: session } = await supabase
        .from('register_sessions')
        .select('id')
        .eq('store_id', order.store_id)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase.rpc('refund_order', {
        p_order_id: orderId,
        p_amount: amount,
        p_method: method,
        p_reason: reason,
        p_register_session_id: session?.id ?? null,
        p_kind: kind,
        p_items:
          items && items.length > 0
            ? items.map((it) => ({
                order_item_id: it.orderItemId,
                quantity: it.quantity,
                amount: it.amount,
                restock: it.restock,
              }))
            : null,
      });
      if (error) throw new Error(translateRefundError(error.message));
    }
  );

  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath('/app/orders');
}

/**
 * 再会計: 全額返金済み（status='refunded' かつ 返金合計=支払合計）の取引のみ、
 * activeだった品目を複製した新しい注文(open)を作成する。元取引はrefundedのまま残す（物理削除なし）。
 */
export async function reopenOrder(orderId: string, reason: string): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.refund');
  if (!reason.trim()) throw new Error('再会計理由を入力してください');
  const supabase = await createClient();

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error('注文が見つかりません');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) {
    throw new Error('この店舗の操作はできません');
  }
  if (order.status !== 'refunded') {
    throw new Error('先に全額返金してください');
  }

  const [{ data: payments }, { data: refunds }, { data: existingDerived }] = await Promise.all([
    supabase.from('payments').select('amount').eq('order_id', orderId).eq('status', 'completed'),
    supabase.from('refunds').select('amount').eq('order_id', orderId),
    supabase.from('orders').select('id').eq('source_order_id', orderId).eq('status', 'open').limit(1).maybeSingle(),
  ]);
  const totalPaid = (payments ?? []).reduce((a, p) => a + p.amount, 0);
  const totalRefunded = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  if (totalPaid <= 0 || totalRefunded < totalPaid) {
    throw new Error('先に全額返金してください');
  }
  if (existingDerived) {
    throw new Error('この取引の再会計伝票は既に作成されています');
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('status', 'active');

  const { data: newOrder, error: insErr } = await supabase
    .from('orders')
    .insert({
      organization_id: order.organization_id,
      store_id: order.store_id,
      reservation_id: order.reservation_id,
      customer_id: order.customer_id,
      table_id: order.table_id,
      order_type: order.order_type,
      status: 'open',
      guest_count: order.guest_count,
      staff_id: ctx.userId,
      source_order_id: order.id,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (insErr || !newOrder) {
    console.error('[orders.reopenOrder] failed to create new order:', insErr);
    const translated = insErr ? translateOrderError(insErr.message) : null;
    throw new Error(translated ?? '再会計に失敗しました。通信状態を確認して再度お試しください');
  }
  const newOrderId = newOrder.id as string;

  if (items && items.length > 0) {
    const rows = items.map((it) => ({
      organization_id: it.organization_id,
      store_id: it.store_id,
      order_id: newOrderId,
      menu_item_id: it.menu_item_id,
      name: it.name,
      unit_price: it.unit_price,
      quantity: it.quantity,
      tax_rate: it.tax_rate,
      tax_included: it.tax_included,
      modifiers: it.modifiers,
      memo: it.memo,
      line_total: it.line_total,
      staff_id: ctx.userId,
      status: 'active',
      created_by: ctx.userId,
    }));
    const { error: itemsErr } = await supabase.from('order_items').insert(rows);
    if (itemsErr) {
      console.error('[orders.reopenOrder] failed to duplicate items:', itemsErr);
      throw new Error('再会計に失敗しました。通信状態を確認して再度お試しください');
    }
  }

  await supabase.rpc('recalc_order_totals', { p_order_id: newOrderId });

  await supabase.rpc('log_audit', {
    p_org: order.organization_id,
    p_store: order.store_id,
    p_action: 'order.reopen',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: { status: order.status },
    p_after: { new_order_id: newOrderId },
    p_note: reason,
  });

  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath('/app/orders');
  revalidatePath('/app/pos');
  return { orderId: newOrderId };
}
