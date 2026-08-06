import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst, daysAgoJst, weekdayJa } from '@/lib/format';

function dateSequence(fromStr: string, toStr: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromStr}T00:00:00Z`);
  const end = new Date(`${toStr}T00:00:00Z`);
  while (cursor <= end && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

/** 日別サマリCSV（from/to指定、デフォルト過去30日） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  if (!can(ctx.role, 'reports.view')) {
    return new Response('レポートの閲覧権限がありません', { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  let from = searchParams.get('from') || daysAgoJst(29);
  let to = searchParams.get('to') || todayJst();
  if (from > to) [from, to] = [to, from];

  const supabase = await createClient();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data: orders } = await supabase
    .from('orders')
    .select('total, guest_count, discount_total, status, store_id, business_date')
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .in('status', ['paid', 'refunded']);

  const byDate = new Map<string, { sales: number; count: number; guests: number; discount: number }>();
  for (const o of orders ?? []) {
    const cur = byDate.get(o.business_date) ?? { sales: 0, count: 0, guests: 0, discount: 0 };
    cur.count += 1;
    cur.guests += o.guest_count;
    if (o.status === 'paid') {
      cur.sales += o.total;
      cur.discount += o.discount_total;
    }
    byDate.set(o.business_date, cur);
  }

  const rows = dateSequence(from, to).map((date) => {
    const v = byDate.get(date) ?? { sales: 0, count: 0, guests: 0, discount: 0 };
    const avgSpend = v.guests > 0 ? Math.floor(v.sales / v.guests) : 0;
    return [date, weekdayJa(date), v.sales, v.count, v.guests, avgSpend, v.discount];
  });

  const csv = toCsv(['日付', '曜日', '売上', '会計件数', '客数', '客単価', '値引き額'], rows);
  return csvResponse(`日別サマリ_${from}_${to}.csv`, csv);
}
