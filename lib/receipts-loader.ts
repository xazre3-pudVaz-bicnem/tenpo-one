import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildReceipt, type ReceiptData } from '@/lib/receipts';
import { METHOD_LABELS } from '@/components/cash/labels';

/**
 * 注文IDからレシート表示モデル(ReceiptData)を構築する（サーバ共用）。
 * レシートページ表示・CloudPRNTジョブのMarkup生成の双方から利用する。
 * 渡された supabase クライアントの権限で読む（セッション=RLS適用 / admin=全件）。
 * 見つからない場合は null。
 */
export async function loadReceiptData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orderId: string,
  opts: { isReissue?: boolean } = {}
): Promise<{ receipt: ReceiptData; storeId: string; storeName: string } | null> {
  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, subtotal, tax_total, service_charge, discount_total, coupon_code, customer_id, register_session_id, staff_id, total, closed_at, store_id, stores(name, address, phone), profiles(display_name)'
    )
    .eq('id', orderId)
    .single();
  if (!order) return null;

  const [{ data: items }, { data: payments }, { data: settings }, { data: refunds }, { data: pointTx }] =
    await Promise.all([
      supabase
        .from('order_items')
        .select('id, name, unit_price, quantity, tax_rate, tax_included, line_total, modifiers')
        .eq('order_id', orderId)
        .eq('status', 'active')
        .order('created_at'),
      supabase
        .from('payments')
        .select('method, amount, tendered, change_amount, paid_at')
        .eq('order_id', orderId)
        .order('paid_at'),
      supabase
        .from('store_settings')
        .select('receipt_header, receipt_footer, invoice_registration_number')
        .eq('store_id', order.store_id)
        .maybeSingle(),
      supabase.from('refunds').select('amount').eq('order_id', orderId),
      supabase.from('point_transactions').select('kind, points').eq('order_id', orderId),
    ]);

  let registerName: string | null = null;
  if (order.register_session_id) {
    const { data: session } = await supabase
      .from('register_sessions')
      .select('registers(name)')
      .eq('id', order.register_session_id)
      .maybeSingle();
    registerName = (session?.registers as unknown as { name: string } | null)?.name ?? null;
  }

  let pointBalance: number | null = null;
  if (order.customer_id) {
    const { data: cust } = await supabase
      .from('customers')
      .select('point_balance')
      .eq('id', order.customer_id)
      .maybeSingle();
    pointBalance = cust?.point_balance ?? null;
  }
  const pointsEarned = (pointTx ?? []).filter((t) => t.kind === 'earn').reduce((a, t) => a + t.points, 0);
  const pointsUsed = Math.abs(
    (pointTx ?? []).filter((t) => t.kind === 'redeem').reduce((a, t) => a + t.points, 0)
  );

  const storeInfo = order.stores as unknown as { name: string; address: string | null; phone: string | null } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;

  const receipt = buildReceipt({
    store: {
      name: storeInfo?.name ?? '',
      address: storeInfo?.address ?? null,
      phone: storeInfo?.phone ?? null,
      registrationNumber: settings?.invoice_registration_number ?? null,
      headerMessage: settings?.receipt_header ?? null,
      footerMessage: settings?.receipt_footer ?? null,
    },
    order: {
      orderNo: order.order_no,
      closedAt: order.closed_at,
      subtotal: order.subtotal,
      taxTotal: order.tax_total,
      serviceCharge: order.service_charge,
      discountTotal: order.discount_total,
      couponCode: order.coupon_code,
      total: order.total,
    },
    items: (items ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
      taxRate: i.tax_rate,
      modifiers: (i.modifiers as { name: string; price: number }[] | null) ?? [],
    })),
    payments: (payments ?? []).map((p) => ({
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      change: p.change_amount,
    })),
    refunds: (refunds ?? []).map((r) => ({ amount: r.amount })),
    registerName,
    staffName: staff?.display_name ?? null,
    isReissue: opts.isReissue ?? false,
    methodLabels: METHOD_LABELS,
    points: order.customer_id ? { earned: pointsEarned, used: pointsUsed, balance: pointBalance } : undefined,
  });

  return { receipt, storeId: order.store_id, storeName: storeInfo?.name ?? '' };
}
