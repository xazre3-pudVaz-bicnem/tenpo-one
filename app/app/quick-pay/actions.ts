'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  QUICK_PAY_LINE_NAME,
  QUICK_PAY_TAX_RATE,
  quickPayDiscountAmount,
  quickPayDiscountReason,
  quickPayProblem,
  type QuickPayDiscount,
  type QuickPayLine,
} from '@/lib/quick-pay';
import { setDiscount } from '@/app/app/pos/actions';

/**
 * 即会計（2026-09-30 Ronnie「電卓のレジのように金額だけで会計できるように。手書きの伝票の合計だけで会計するお店のため」）。
 *
 * 卓なしの店内の伝票（order_type=dine_in・table_id なし・メモ「即会計」）を作り、電卓で入れた金額を
 * メニューに無い明細（menu_item_id なし・税込10%）として入れる。会計はいつもの会計画面（/app/pos?checkout=1）。
 * 「メニュー選択」で入れた商品はハンディと同じ submitHandyOrder で入れて厨房へ送る。
 */

async function loadQuickOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: Awaited<ReturnType<typeof requirePermission>>,
  orderId: string
) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, status, organization_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) throw new Error('伝票が見つかりません');
  await assertStoreAccess(ctx, order.store_id);
  if (order.status !== 'open') throw new Error('この伝票は既に会計済み・取消済みです');
  return order;
}

/** 即会計の伝票を作る（「メニュー選択」を押したとき・会計のとき） */
export async function startQuickOrder(guestCount: number): Promise<{ orderId: string }> {
  const ctx = await requirePermission('pos.order');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) throw new Error('アクセス可能な店舗がありません');
  const guests = Number.isInteger(guestCount) && guestCount >= 1 && guestCount <= 999 ? guestCount : 1;

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      organization_id: ctx.organizationId,
      store_id: store.id,
      order_type: 'dine_in',
      status: 'open',
      guest_count: guests,
      memo: QUICK_PAY_LINE_NAME,
      staff_id: ctx.userId,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !order) throw new Error(error?.message ?? '伝票を作れませんでした');
  revalidatePath('/app/quick-pay');
  return { orderId: order.id as string };
}

/**
 * 会計の前に、電卓で入れた金額を明細にして伝票に入れる（伝票が無ければ作る）。
 * 明細は厨房に出さない（menu_item_id なし。厨房伝票・KDS は menu_item_id のある明細だけ）。
 * 念のため「厨房へ送信済み・印刷済み・提供済み」で入れる（未送信の品として会計で厨房へ送られないように）。
 */
export async function prepareQuickCheckout(input: {
  orderId: string | null;
  guestCount: number;
  /** 単価 × 個数（530 × 2 など） */
  lines: QuickPayLine[];
  /** 値引（円）・割引（%）。無ければ null */
  discount?: QuickPayDiscount | null;
}): Promise<{ orderId?: string; error?: string }> {
  const ctx = await requirePermission('pos.checkout');
  const lines: QuickPayLine[] = (input.lines ?? []).map((l) => ({
    amount: Math.round(Number(l?.amount)),
    quantity: Math.round(Number(l?.quantity)),
  }));
  const problem = quickPayProblem(lines);
  if (problem) return { error: problem };
  const guests =
    Number.isInteger(input.guestCount) && input.guestCount >= 1 && input.guestCount <= 999 ? input.guestCount : 1;

  const supabase = await createClient();
  let orderId = input.orderId;
  try {
    if (orderId) {
      await loadQuickOrder(supabase, ctx, orderId);
    } else {
      if (lines.length === 0) return { error: '金額を入れてください' };
      ({ orderId } = await startQuickOrder(guests));
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : '伝票を開けませんでした' };
  }
  const order = await loadQuickOrder(supabase, ctx, orderId);

  await supabase.from('orders').update({ guest_count: guests, updated_by: ctx.userId }).eq('id', orderId);

  if (lines.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('order_items').insert(
      lines.map(({ amount, quantity }) => ({
        organization_id: order.organization_id,
        store_id: order.store_id,
        order_id: orderId as string,
        menu_item_id: null,
        name: QUICK_PAY_LINE_NAME,
        unit_price: amount,
        quantity,
        tax_rate: QUICK_PAY_TAX_RATE,
        tax_included: true,
        line_total: amount * quantity,
        modifiers: [],
        staff_id: ctx.userId,
        status: 'active',
        created_by: ctx.userId,
        kitchen_sent_at: now,
        kitchen_printed_qty: quantity,
        kitchen_status: 'served',
      }))
    );
    if (error) return { error: `金額を入れられませんでした: ${error.message}` };
  }

  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });

  // 値引・割引（クラシックレジの「値引」「割引」キー）。伝票の値引として入れる（会計画面・レシートにも出る）
  const discount = input.discount ?? null;
  if (discount && (discount.kind === 'yen' || discount.kind === 'percent')) {
    const { data: before } = await supabase
      .from('orders')
      .select('total, discount_total')
      .eq('id', orderId)
      .maybeSingle();
    const base = Number(before?.total ?? 0) + Number(before?.discount_total ?? 0);
    const off = quickPayDiscountAmount(base, { kind: discount.kind, value: Math.round(Number(discount.value)) });
    if (off > 0) {
      try {
        await setDiscount(orderId, off, quickPayDiscountReason({ kind: discount.kind, value: Math.round(Number(discount.value)) }));
      } catch (e) {
        return { orderId, error: e instanceof Error ? e.message : '値引できませんでした' };
      }
    }
  }

  const { data: totals } = await supabase.from('orders').select('total').eq('id', orderId).maybeSingle();
  if (!totals || Number(totals.total) <= 0) return { orderId, error: '会計する金額がありません' };

  revalidatePath('/app/pos');
  revalidatePath('/app/quick-pay');
  return { orderId };
}

