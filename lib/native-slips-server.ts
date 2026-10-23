import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { orderPeriodPresets } from '@/lib/order-period-presets';
import { isQuickPayOrder, QUICK_PAY_LINE_NAME } from '@/lib/quick-pay';
import { METHOD_LABELS } from '@/components/cash/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PAGE_SIZE = 50;
type PayKey = 'cash' | 'credit' | 'emoney' | 'points' | 'other';
function payKeyOf(method: string): PayKey {
  if (method === 'cash') return 'cash';
  if (method === 'credit') return 'credit';
  if (method === 'emoney') return 'emoney';
  if (method === 'points' || method === 'site_points') return 'points';
  return 'other';
}

/** 伝票明細の一覧（GET ?part=slips）。Web の app/app/orders/page.tsx と同じ組み立て */
export interface NativeSlipsPayload {
  store: { id: string; name: string };
  today: string;
  from: string;
  to: string;
  status: string;
  method: string;
  q: string;
  page: number;
  totalPages: number;
  presets: { label: string; from: string; to: string }[];
  methods: { key: string; label: string }[];
  sales: { settledSales: number; settledCount: number; guests: number; perGuest: number; unsettledCount: number; unsettledTotal: number };
  orders: {
    id: string;
    orderNo: number;
    place: string;
    status: string;
    voided: boolean;
    partiallyRefunded: boolean;
    total: number;
    refundTotal: number;
    discountTotal: number;
    guestCount: number;
    openedAt: string;
    closedAt: string | null;
    clerk: string | null;
    pay: Record<PayKey, number>;
    ryoshushoIssued: boolean;
  }[];
  canRefund: boolean;
  canCheckout: boolean;
}

export async function loadNativeSlips(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string },
  sp: { from?: string | null; to?: string | null; status?: string | null; method?: string | null; q?: string | null; page?: string | null }
): Promise<NativeSlipsPayload> {
  const today = todayJst();
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && DATE.test(sp.from) ? sp.from : today;
  const to = sp.to && DATE.test(sp.to) ? sp.to : today;
  const status = ['open', 'paid', 'refunded', 'cancelled', 'void'].includes(sp.status ?? '') ? (sp.status as string) : '';
  const method = sp.method && sp.method in METHOD_LABELS ? sp.method : '';
  const q = (sp.q ?? '').trim().slice(0, 12);
  const page = Math.max(1, Number(sp.page) || 1);

  let orderIdsByMethod: string[] | null = null;
  if (method) {
    const { data: pays } = await supabase.from('payments').select('order_id').eq('store_id', store.id).eq('method', method);
    orderIdsByMethod = [...new Set((pays ?? []).map((p) => p.order_id as string))];
  }
  let query = supabase
    .from('orders')
    .select('id, order_no, opened_at, closed_at, status, total, discount_total, guest_count, order_type, table_id, memo, clerk_name, restaurant_tables(name), profiles(display_name)', { count: 'exact' })
    .eq('store_id', store.id)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('opened_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (orderIdsByMethod) query = query.in('id', orderIdsByMethod.length > 0 ? orderIdsByMethod : ['00000000-0000-0000-0000-000000000000']);
  const orderNoQuery = q.replace(/^#/, '');
  if (orderNoQuery && /^\d+$/.test(orderNoQuery)) query = query.eq('order_no', Number(orderNoQuery));
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const [{ data: orders, count }, { data: periodRows }] = await Promise.all([
    query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1),
    supabase.from('orders').select('status, total, guest_count').eq('store_id', store.id).gte('business_date', from).lte('business_date', to).in('status', ['open', 'paid', 'refunded']).limit(10000),
  ]);
  const settled = (periodRows ?? []).filter((o) => o.status === 'paid' || o.status === 'refunded');
  const unsettled = (periodRows ?? []).filter((o) => o.status === 'open');
  const sum = (rows: { total: number }[]) => rows.reduce((a, o) => a + Number(o.total), 0);
  const settledSales = sum(settled);
  const guests = settled.reduce((a, o) => a + Number(o.guest_count ?? 0), 0);

  const ids = (orders ?? []).map((o) => o.id as string);
  const [{ data: refundRows }, { data: paymentRows }, { data: ryoRows }] =
    ids.length > 0
      ? await Promise.all([
          supabase.from('refunds').select('order_id, amount, kind').in('order_id', ids),
          supabase.from('payments').select('order_id, method, amount').in('order_id', ids).eq('status', 'completed'),
          supabase.from('print_jobs').select('order_id, status').in('order_id', ids).eq('job_type', 'ryoshusho').neq('status', 'failed'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
  const ryoIssued = new Set(((ryoRows ?? []) as { order_id: string | null }[]).map((r) => r.order_id).filter(Boolean));
  const refundTotal = new Map<string, number>();
  const voided = new Set<string>();
  for (const r of (refundRows ?? []) as { order_id: string; amount: number; kind: string }[]) {
    refundTotal.set(r.order_id, (refundTotal.get(r.order_id) ?? 0) + r.amount);
    if (r.kind === 'void') voided.add(r.order_id);
  }
  const payBy = new Map<string, Record<PayKey, number>>();
  for (const p of (paymentRows ?? []) as { order_id: string; method: string; amount: number }[]) {
    const row = payBy.get(p.order_id) ?? { cash: 0, credit: 0, emoney: 0, points: 0, other: 0 };
    row[payKeyOf(p.method)] += Number(p.amount ?? 0);
    payBy.set(p.order_id, row);
  }

  return {
    store,
    today,
    from,
    to,
    status,
    method,
    q,
    page,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    presets: orderPeriodPresets(today),
    methods: Object.entries(METHOD_LABELS).map(([key, label]) => ({ key, label })),
    sales: {
      settledSales,
      settledCount: settled.length,
      guests,
      perGuest: guests > 0 ? Math.round(settledSales / guests) : 0,
      unsettledCount: unsettled.length,
      unsettledTotal: sum(unsettled),
    },
    orders: (orders ?? []).map((o) => {
      const table = o.restaurant_tables as unknown as { name: string } | null;
      const staff = o.profiles as unknown as { display_name: string } | null;
      const rt = refundTotal.get(o.id as string) ?? 0;
      const isVoid = voided.has(o.id as string);
      return {
        id: o.id as string,
        orderNo: o.order_no as number,
        place:
          table?.name ??
          (o.order_type === 'takeout'
            ? 'テイクアウト'
            : isQuickPayOrder({ table_id: o.table_id as string | null, order_type: o.order_type as string, memo: o.memo as string | null })
              ? QUICK_PAY_LINE_NAME
              : '—'),
        status: o.status as string,
        voided: isVoid,
        partiallyRefunded: !isVoid && o.status === 'paid' && rt > 0,
        total: Number(o.total),
        refundTotal: rt,
        discountTotal: Number(o.discount_total ?? 0),
        guestCount: Number(o.guest_count ?? 0),
        openedAt: o.opened_at as string,
        closedAt: (o.closed_at as string | null) ?? null,
        clerk: (o.clerk_name as string | null) ?? staff?.display_name ?? null,
        pay: payBy.get(o.id as string) ?? { cash: 0, credit: 0, emoney: 0, points: 0, other: 0 },
        ryoshushoIssued: ryoIssued.has(o.id as string),
      };
    }),
    canRefund: can(ctx.role, 'pos.refund'),
    canCheckout: can(ctx.role, 'pos.checkout'),
  };
}

/** 伝票の詳細（GET ?part=slip&id=…）。Web の app/app/orders/[id]/page.tsx の品目・支払・返金・会計情報・返金できる品目 */
export interface NativeSlipDetail {
  id: string;
  orderNo: number;
  place: string;
  status: string;
  guestCount: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  discountReason: string | null;
  total: number;
  openedAt: string;
  closedAt: string | null;
  customerName: string | null;
  items: { id: string; name: string; unitPrice: number; quantity: number; lineTotal: number; status: string; cancelReason: string | null }[];
  payments: { id: string; method: string; label: string; amount: number; tendered: number | null; change: number | null; paidAt: string; status: string }[];
  refunds: { id: string; kind: string; method: string; label: string; amount: number; reason: string; at: string; items: string[] }[];
  totalPaid: number;
  totalRefunded: number;
  refundable: number;
  refundableItems: { orderItemId: string; name: string; remainingQty: number; remainingAmount: number }[];
  paymentBreakdown: { method: string; label: string; paid: number; refunded: number }[];
  hasVoid: boolean;
  canRefund: boolean;
  canReopen: boolean;
  fullyRefunded: boolean;
  openDerived: { id: string; orderNo: number } | null;
  ryoshushoIssued: boolean;
}

export async function loadNativeSlipDetail(ctx: SessionContext, supabase: Supabase, id: string): Promise<NativeSlipDetail | null> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_no, order_type, status, guest_count, subtotal, tax_total, service_charge, discount_total, discount_reason, total, opened_at, closed_at, store_id, table_id, memo, restaurant_tables(name), customers(name)')
    .eq('id', id)
    .maybeSingle();
  if (!order || (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id))) return null;
  const [{ data: items }, { data: payments }, { data: refunds }, { data: derived }, { data: ryo }] = await Promise.all([
    supabase.from('order_items').select('id, name, unit_price, quantity, line_total, status, cancel_reason').eq('order_id', id).order('created_at'),
    supabase.from('payments').select('id, method, amount, tendered, change_amount, paid_at, status').eq('order_id', id).order('paid_at'),
    supabase.from('refunds').select('id, amount, method, reason, refunded_at, kind').eq('order_id', id).order('refunded_at'),
    supabase.from('orders').select('id, order_no, status').eq('source_order_id', id).order('created_at'),
    supabase.from('print_jobs').select('id').eq('order_id', id).eq('job_type', 'ryoshusho').neq('status', 'failed').limit(1),
  ]);
  const refundIds = (refunds ?? []).map((r) => r.id as string);
  const { data: refundItems } = refundIds.length
    ? await supabase.from('refund_items').select('refund_id, order_item_id, quantity, amount').in('refund_id', refundIds)
    : { data: [] as { refund_id: string; order_item_id: string; quantity: number; amount: number }[] };

  const totalPaid = (payments ?? []).filter((p) => p.status === 'completed').reduce((a, p) => a + Number(p.amount), 0);
  const totalRefunded = (refunds ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const refundable = Math.max(0, totalPaid - totalRefunded);
  const paidBy = new Map<string, number>();
  for (const p of (payments ?? []).filter((p) => p.status === 'completed')) paidBy.set(p.method as string, (paidBy.get(p.method as string) ?? 0) + Number(p.amount));
  const refundedBy = new Map<string, number>();
  for (const r of refunds ?? []) refundedBy.set(r.method as string, (refundedBy.get(r.method as string) ?? 0) + Number(r.amount));
  const refundedByItem = new Map<string, { qty: number; amount: number }>();
  for (const ri of (refundItems ?? []) as { order_item_id: string; quantity: number; amount: number }[]) {
    const cur = refundedByItem.get(ri.order_item_id) ?? { qty: 0, amount: 0 };
    cur.qty += Number(ri.quantity);
    cur.amount += Number(ri.amount);
    refundedByItem.set(ri.order_item_id, cur);
  }
  const nameById = new Map((items ?? []).map((it) => [it.id as string, it.name as string]));
  const table = order.restaurant_tables as unknown as { name: string } | null;
  const customer = order.customers as unknown as { name: string } | null;
  const openDerived = (derived ?? []).find((d) => d.status === 'open');
  return {
    id: order.id as string,
    orderNo: order.order_no as number,
    place:
      table?.name ??
      (order.order_type === 'takeout'
        ? 'テイクアウト'
        : isQuickPayOrder({ table_id: order.table_id as string | null, order_type: order.order_type as string, memo: order.memo as string | null })
          ? QUICK_PAY_LINE_NAME
          : '店内'),
    status: order.status as string,
    guestCount: Number(order.guest_count ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    taxTotal: Number(order.tax_total ?? 0),
    serviceCharge: Number(order.service_charge ?? 0),
    discountTotal: Number(order.discount_total ?? 0),
    discountReason: (order.discount_reason as string | null) ?? null,
    total: Number(order.total ?? 0),
    openedAt: order.opened_at as string,
    closedAt: (order.closed_at as string | null) ?? null,
    customerName: customer?.name ?? null,
    items: (items ?? []).map((it) => ({
      id: it.id as string,
      name: it.name as string,
      unitPrice: Number(it.unit_price),
      quantity: Number(it.quantity),
      lineTotal: Number(it.line_total),
      status: it.status as string,
      cancelReason: (it.cancel_reason as string | null) ?? null,
    })),
    payments: (payments ?? []).map((p) => ({
      id: p.id as string,
      method: p.method as string,
      label: METHOD_LABELS[p.method as string] ?? (p.method as string),
      amount: Number(p.amount),
      tendered: p.tendered == null ? null : Number(p.tendered),
      change: p.change_amount == null ? null : Number(p.change_amount),
      paidAt: p.paid_at as string,
      status: p.status as string,
    })),
    refunds: (refunds ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      method: r.method as string,
      label: METHOD_LABELS[r.method as string] ?? (r.method as string),
      amount: Number(r.amount),
      reason: r.reason as string,
      at: r.refunded_at as string,
      items: ((refundItems ?? []) as { refund_id: string; order_item_id: string; quantity: number }[])
        .filter((ri) => ri.refund_id === r.id)
        .map((ri) => `${nameById.get(ri.order_item_id) ?? '品目'} ×${Number(ri.quantity)}`),
    })),
    totalPaid,
    totalRefunded,
    refundable,
    refundableItems: (items ?? [])
      .filter((it) => it.status === 'active')
      .map((it) => {
        const already = refundedByItem.get(it.id as string) ?? { qty: 0, amount: 0 };
        return { orderItemId: it.id as string, name: it.name as string, remainingQty: Number(it.quantity) - already.qty, remainingAmount: Number(it.line_total) - already.amount };
      })
      .filter((it) => it.remainingQty > 0.0001 && it.remainingAmount > 0),
    paymentBreakdown: [...new Set([...paidBy.keys(), ...refundedBy.keys()])].map((m) => ({ method: m, label: METHOD_LABELS[m] ?? m, paid: paidBy.get(m) ?? 0, refunded: refundedBy.get(m) ?? 0 })),
    hasVoid: (refunds ?? []).some((r) => r.kind === 'void'),
    canRefund: can(ctx.role, 'pos.refund') && ['paid', 'refunded'].includes(order.status as string) && refundable > 0,
    canReopen: can(ctx.role, 'pos.refund') && ['paid', 'refunded'].includes(order.status as string),
    fullyRefunded: order.status === 'refunded' && refundable === 0 && totalPaid > 0,
    openDerived: openDerived ? { id: openDerived.id as string, orderNo: openDerived.order_no as number } : null,
    ryoshushoIssued: (ryo ?? []).length > 0,
  };
}
