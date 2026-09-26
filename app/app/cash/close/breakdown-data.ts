import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import { computeCloseBreakdown, monthRange, type BreakdownItem, type BreakdownOrder, type CloseBreakdown } from '@/lib/close-breakdown';

export type BreakdownPeriod = 'day' | 'month';

/**
 * レジクローズの「売上の内訳」のデータ（2026-09-27 Ronnie）。
 * period='day' は business_date = date、'month' は date の月（'YYYY-MM'）。
 */
export async function loadCloseBreakdown(storeId: string, period: BreakdownPeriod, date: string): Promise<CloseBreakdown> {
  const supabase = await createClient();

  let q = supabase
    .from('orders')
    .select('id, total, guest_count, clerk_name, reservation_id, order_type')
    .eq('store_id', storeId)
    .in('status', [...SETTLED_ORDER_STATUSES])
    .limit(20000);
  if (period === 'day') q = q.eq('business_date', date);
  else {
    const { from, toExclusive } = monthRange(date);
    q = q.gte('business_date', from).lt('business_date', toExclusive);
  }
  const { data: orderRows } = await q;
  const orders = orderRows ?? [];
  if (orders.length === 0) return computeCloseBreakdown([], []);

  const orderIds = orders.map((o) => o.id as string);
  const reservationIds = [...new Set(orders.map((o) => o.reservation_id as string | null).filter((x): x is string => !!x))];

  const [{ data: reservations }, itemRows] = await Promise.all([
    reservationIds.length
      ? supabase.from('reservations').select('id, source_id, reservation_sources(name)').in('id', reservationIds)
      : Promise.resolve({ data: [] as { id: string; source_id: string | null; reservation_sources: unknown }[] }),
    loadItems(orderIds),
  ]);

  const sourceByReservation = new Map<string, string>();
  for (const r of reservations ?? []) {
    const src = r.reservation_sources as { name: string } | { name: string }[] | null;
    const name = Array.isArray(src) ? src[0]?.name : src?.name;
    if (name) sourceByReservation.set(r.id as string, name);
  }

  // メニューの種類（コース／ドリンク…）とカテゴリのステーション
  const menuIds = [...new Set(itemRows.map((i) => i.menu_item_id as string | null).filter((x): x is string => !!x))];
  const menuMeta = new Map<string, { itemType: string | null; station: string | null; includesDrinks: boolean }>();
  for (let i = 0; i < menuIds.length; i += 500) {
    const chunk = menuIds.slice(i, i + 500);
    const { data: menus } = await supabase
      .from('menu_items')
      .select('id, item_type, course_includes_drinks, menu_categories(station)')
      .in('id', chunk);
    for (const m of menus ?? []) {
      const cat = m.menu_categories as { station: string | null } | { station: string | null }[] | null;
      const station = Array.isArray(cat) ? (cat[0]?.station ?? null) : (cat?.station ?? null);
      menuMeta.set(m.id as string, {
        itemType: (m.item_type as string | null) ?? null,
        station,
        includesDrinks: m.course_includes_drinks === true,
      });
    }
  }

  const bo: BreakdownOrder[] = orders.map((o) => ({
    id: o.id as string,
    total: (o.total as number) ?? 0,
    guestCount: (o.guest_count as number) ?? 0,
    clerkName: (o.clerk_name as string | null) ?? null,
    sourceName: o.reservation_id ? (sourceByReservation.get(o.reservation_id as string) ?? 'ネット予約') : null,
    orderType: (o.order_type as string | null) ?? null,
  }));
  const bi: BreakdownItem[] = itemRows.map((i) => {
    const meta = i.menu_item_id ? menuMeta.get(i.menu_item_id as string) : undefined;
    return {
      orderId: i.order_id as string,
      menuItemId: (i.menu_item_id as string | null) ?? null,
      name: (i.name as string) ?? '',
      unitPrice: (i.unit_price as number) ?? 0,
      quantity: (i.quantity as number) ?? 0,
      lineTotal: (i.line_total as number) ?? 0,
      cancelled: i.status === 'cancelled',
      itemType: meta?.itemType ?? null,
      station: meta?.station ?? null,
      includesDrinks: meta?.includesDrinks ?? false,
    };
  });
  return computeCloseBreakdown(bo, bi);
}

interface ItemRowDb {
  order_id: string;
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  status: string;
}

async function loadItems(orderIds: string[]): Promise<ItemRowDb[]> {
  const supabase = await createClient();
  const out: ItemRowDb[] = [];
  for (let i = 0; i < orderIds.length; i += 300) {
    const chunk = orderIds.slice(i, i + 300);
    const { data } = await supabase
      .from('order_items')
      .select('order_id, menu_item_id, name, unit_price, quantity, line_total, status')
      .in('order_id', chunk)
      .limit(20000);
    for (const r of data ?? []) out.push(r as unknown as ItemRowDb);
  }
  return out;
}
