import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/state';
import { ReceiptView } from '@/components/pos/receipt-view';
import { logPrintJob } from '@/app/app/pos/actions';

export const metadata: Metadata = { title: 'レシート' };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const ctx = await requireMember();
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, guest_count, subtotal, tax_total, service_charge, discount_total, discount_reason, total, closed_at, business_date, store_id, stores(name, address, phone)'
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

  const [{ data: items }, { data: payments }, { data: settings }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, name, unit_price, quantity, tax_rate, tax_included, line_total')
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
  ]);

  const storeInfo = order.stores as unknown as { name: string; address: string | null; phone: string | null } | null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/app/pos" className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          POSへ戻る
        </Link>
      </div>

      <ReceiptView
        order={{
          id: order.id,
          orderNo: order.order_no,
          orderType: order.order_type,
          guestCount: order.guest_count,
          subtotal: order.subtotal,
          taxTotal: order.tax_total,
          serviceCharge: order.service_charge,
          discountTotal: order.discount_total,
          discountReason: order.discount_reason,
          total: order.total,
          closedAt: order.closed_at,
          businessDate: order.business_date,
        }}
        items={items ?? []}
        payments={payments ?? []}
        store={{
          name: storeInfo?.name ?? '',
          address: storeInfo?.address ?? null,
          phone: storeInfo?.phone ?? null,
          receiptHeader: settings?.receipt_header ?? null,
          receiptFooter: settings?.receipt_footer ?? null,
          invoiceRegistrationNumber: settings?.invoice_registration_number ?? null,
        }}
        logPrintJobAction={logPrintJob}
      />
    </div>
  );
}
