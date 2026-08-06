import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/components/orders/status-badge';
import { METHOD_LABELS } from '@/components/cash/labels';

export async function GET(request: Request) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) {
    return csvResponse('orders.csv', toCsv(['エラー'], [['アクセス可能な店舗がありません']]));
  }

  const url = new URL(request.url);
  const today = todayJst();
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || today;

  const { data: orders } = await supabase
    .from('orders')
    .select(
      'id, order_no, opened_at, status, order_items(name, quantity, unit_price, line_total, tax_rate, status), payments(method)'
    )
    .eq('store_id', store.id)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('opened_at');

  const rows: (string | number | null)[][] = [];
  for (const o of orders ?? []) {
    const methods = [
      ...new Set(((o.payments ?? []) as unknown as { method: string }[]).map((p) => METHOD_LABELS[p.method] ?? p.method)),
    ].join('/');
    const orderItems = (o.order_items ?? []) as unknown as {
      name: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      tax_rate: number;
      status: string;
    }[];
    for (const item of orderItems) {
      rows.push([
        o.order_no,
        o.opened_at,
        store.name,
        item.name,
        item.quantity,
        item.unit_price,
        item.line_total,
        `${item.tax_rate}%`,
        methods,
        item.status === 'cancelled' ? '取消' : ORDER_STATUS_LABELS[o.status] ?? o.status,
      ]);
    }
  }

  const csv = toCsv(
    ['注文番号', '日時', '店舗', '品名', '数量', '単価', '行合計', '税率', '支払方法', '状態'],
    rows
  );
  return csvResponse(`orders_${from}_${to}.csv`, csv);
}
