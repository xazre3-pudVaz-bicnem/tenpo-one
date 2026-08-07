import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { buildReceipt } from '@/lib/receipts';
import { METHOD_LABELS } from '@/components/cash/labels';
import { EmptyState } from '@/components/ui/state';
import { ReceiptView } from '@/components/pos/receipt-view';
import { logPrintJob } from '@/app/app/pos/actions';

export const metadata: Metadata = { title: 'レシート' };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ reissue?: string }>;
}) {
  const { orderId } = await params;
  const { reissue } = await searchParams;
  const ctx = await requireMember();
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, guest_count, subtotal, tax_total, service_charge, discount_total, coupon_code, customer_id, register_session_id, staff_id, total, closed_at, business_date, store_id, stores(name, address, phone), profiles(display_name)'
    )
    .eq('id', orderId)
    .single();

  if (!order || (store && order.store_id !== store.id && !ctx.isHq)) {
    return (
      <div>
        <EmptyState
          title="レシートが見つかりません"
          description="この注文は存在しないか、アクセスできません"
          action={
            <Link href="/app/pos" className="text-sm font-medium text-primary hover:underline">
              POSへ戻る
            </Link>
          }
        />
      </div>
    );
  }

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
  const pointsEarned = (pointTx ?? [])
    .filter((t) => t.kind === 'earn')
    .reduce((a, t) => a + t.points, 0);
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
    isReissue: reissue === '1',
    methodLabels: METHOD_LABELS,
    // 非会員注文ではポイント欄自体を出さない（buildReceiptは未指定でnull化する）
    points: order.customer_id ? { earned: pointsEarned, used: pointsUsed, balance: pointBalance } : undefined,
  });

  const qrDataUrl = await QRCode.toDataURL(receipt.qrContent, { width: 160, margin: 1 });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/app/pos" className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          POSへ戻る
        </Link>
      </div>

      <ReceiptView receipt={receipt} orderId={order.id} qrDataUrl={qrDataUrl} logPrintJobAction={logPrintJob} />
    </div>
  );
}
