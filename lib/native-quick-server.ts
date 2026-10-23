import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { QUICK_PAY_LINE_NAME } from '@/lib/quick-pay';
import { METHOD_LABELS } from '@/components/cash/labels';
import { todayJst } from '@/lib/format';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 即会計の画面（GET ?part=quick[&order=…]）。Web の app/app/quick-pay/page.tsx と同じ組み立て */
export interface NativeQuickPayload {
  store: { id: string; name: string };
  lineName: string;
  canCheckout: boolean;
  order: { id: string; orderNo: number; guestCount: number; lines: { id: string; name: string; quantity: number; lineTotal: number; isAmount: boolean }[] } | null;
  history: { id: string; orderNo: number; status: string; at: string; total: number; guestCount: number; clerkName: string | null; methods: string[] }[];
}

export async function loadNativeQuick(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }, orderParam: string | null): Promise<NativeQuickPayload> {
  let order: NativeQuickPayload['order'] = null;
  if (orderParam && UUID.test(orderParam)) {
    const { data } = await supabase.from('orders').select('id, order_no, status, store_id, table_id, guest_count').eq('id', orderParam).maybeSingle();
    if (data && data.status === 'open' && data.store_id === store.id && !data.table_id) {
      const { data: items } = await supabase
        .from('order_items')
        .select('id, name, quantity, line_total, menu_item_id')
        .eq('order_id', data.id)
        .eq('status', 'active')
        .order('created_at');
      order = {
        id: data.id as string,
        orderNo: data.order_no as number,
        guestCount: (data.guest_count as number | null) ?? 1,
        lines: (items ?? []).map((i) => ({ id: i.id as string, name: i.name as string, quantity: i.quantity as number, lineTotal: Number(i.line_total) || 0, isAmount: !i.menu_item_id })),
      };
    }
  }
  const { data: historyRows } = await supabase
    .from('orders')
    .select('id, order_no, status, closed_at, opened_at, total, guest_count, clerk_name, payments(method, amount, status)')
    .eq('store_id', store.id)
    .eq('order_type', 'dine_in')
    .is('table_id', null)
    .like('memo', `${QUICK_PAY_LINE_NAME}%`)
    .eq('business_date', todayJst())
    .in('status', ['paid', 'refunded', 'open'])
    .order('opened_at', { ascending: false })
    .limit(200);
  return {
    store,
    lineName: QUICK_PAY_LINE_NAME,
    canCheckout: can(ctx.role, 'pos.checkout'),
    order,
    history: (historyRows ?? []).map((o) => {
      const pays = ((o.payments ?? []) as { method: string; amount: number; status: string }[]).filter((p) => p.status === 'completed');
      return {
        id: o.id as string,
        orderNo: o.order_no as number,
        status: o.status as string,
        at: (o.closed_at ?? o.opened_at) as string,
        total: Number(o.total ?? 0),
        guestCount: (o.guest_count as number | null) ?? 1,
        clerkName: (o.clerk_name as string | null) ?? null,
        methods: [...new Set(pays.map((p) => METHOD_LABELS[p.method] ?? p.method))],
      };
    }),
  };
}
