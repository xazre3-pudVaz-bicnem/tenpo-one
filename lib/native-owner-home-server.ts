import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayJst, daysAgoJst, formatTime } from '@/lib/format';
import { loadHomeData } from '@/components/dashboard/home-data';
import { loadSalesDisplayDay } from '@/lib/register-day-server';
import { salesDayView } from '@/lib/register-day';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type SalesMetricsOptions } from '@/lib/metrics';
import { visibleNavGroups, MOBILE_NAV } from '@/lib/nav';
import { closingNetSales, summarizeOwnerReservations, type OwnerHomeReservation } from '@/lib/native-handy';

/**
 * iPhone アプリ（オーナー・店長モード）のネイティブのホーム（GET /api/app/v1/pos?part=ownerHome）。
 * 中身は Web の /app/dashboard（StoreDashboard・HqDashboard の上の部分）と同じ組み立て（2026-10-24 Ronnie「iPhone のホームもネイティブに」）。
 * 店舗を選んでいれば その店、本社が「全店舗」なら全店の合計＋店舗別の今日の売上。
 */
export interface NativeOwnerHomePayload {
  /** 見ている店。null＝全店舗（本社） */
  store: { id: string; name: string } | null;
  stores: { id: string; name: string }[];
  isHq: boolean;
  displayName: string;
  serverNow: number;
  today: string;
  sales: {
    actual: number;
    avgSpend: number;
    budget: number | null;
    pct: number | null;
    ringPct: number;
    asOf: string;
    date: string;
    dayLabel: string;
    heading: string | null;
    note: string | null;
    canAnalytics: boolean;
  };
  kpis: {
    groups: number;
    groupsYesterday: number;
    guests: number;
    guestsYesterday: number;
    repeaters: number | null;
    walkIns: number;
  };
  /** お知らせ＋アラート＋自動検知の件数（上の鈴のバッジ） */
  noticeCount: number;
  /** 本日の予約（予約の機能が無い企業は null） */
  reservations: {
    count: number;
    covers: number;
    unassigned: number;
    next: OwnerHomeReservation | null;
    list: OwnerHomeReservation[];
  } | null;
  /** 30日推移（レジ締めの純売上。古い順） */
  trend: { date: string; sales: number }[];
  /** 全店舗のとき：店舗別の今日の売上（多い順） */
  byStore: { id: string; name: string; sales: number; guests: number; groups: number }[];
  /** 下のナビ（Web のスマホ下部ナビと同じ） */
  nav: { href: string; label: string; en: string; icon: string }[];
  /** メニュー（Web の /app/menu と同じ並び。グループごと） */
  menu: { label: string | null; en: string | null; items: { href: string; label: string; en: string; icon: string }[] }[];
}

/** 「(YYYY/MM/DD HH:MM時点)」用（Web のホームと同じ） */
function nowStampJst(d: Date = new Date()): string {
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replaceAll('-', '/');
  const time = d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

async function metricsOptions(supabase: SupabaseClient, organizationId: string): Promise<SalesMetricsOptions> {
  const { data: org } = await supabase.from('organizations').select('kpi_settings').eq('id', organizationId).maybeSingle();
  const kpiSettings = (org?.kpi_settings ?? {}) as { includeTakeoutGuests?: boolean };
  return { includeTakeoutGuests: kpiSettings.includeTakeoutGuests ?? true };
}

type ReservationRow = {
  id: string;
  store_id: string;
  start_at: string;
  party_size: number;
  guest_name: string;
  status: string;
  reservation_tables: { table_id: string }[] | null;
};

export async function loadNativeOwnerHome(ctx: SessionContext, supabase: SupabaseClient): Promise<NativeOwnerHomePayload> {
  const today = todayJst();
  const asOf = nowStampJst();
  const store = ctx.currentStore;
  const stores = store ? [store] : ctx.stores;
  const storeIds = stores.map((s) => s.id);
  const nameById = new Map(stores.map((s) => [s.id, s.name]));
  const organizationId = ctx.organizationId as string;
  const opts = await metricsOptions(supabase, organizationId);

  // 売上に出す営業日（店舗のとき：レジの営業日。Web の StoreDashboard と同じ）
  let day = salesDayView({ date: today, today, closed: false });
  let salesAsOf = asOf;
  if (store) {
    const d = await loadSalesDisplayDay(supabase, store.id, today);
    day = salesDayView({ date: d.date, today, closed: d.closed });
    salesAsOf = day.note && d.closedAt ? nowStampJst(new Date(d.closedAt)) : asOf;
  }

  const reservationsOn = !ctx.disabledFeatures.has('reservations') && can(ctx.role, 'reservations.view');
  const [data, reservationsRes, closingsRes, todayOrdersRes, todayRefundsRes] = await Promise.all([
    loadHomeData({
      supabase,
      organizationId,
      userId: ctx.userId,
      role: ctx.role,
      accountingEnabled: !ctx.disabledFeatures.has('accounting'),
      stores,
      isAllStores: !store,
      today,
      salesDate: day.date,
      metricsOpts: opts,
    }),
    reservationsOn && storeIds.length > 0
      ? supabase
          .from('reservations')
          .select('id, store_id, start_at, party_size, guest_name, status, reservation_tables(table_id)')
          .in('store_id', storeIds)
          .eq('reserved_date', today)
          .in('status', ['pending', 'confirmed', 'waiting', 'arrived', 'seated'])
          .order('start_at')
          .limit(200)
      : Promise.resolve({ data: null }),
    storeIds.length > 0
      ? supabase
          .from('daily_closings')
          .select('business_date, sales_total, net_sales, refund_total')
          .in('store_id', storeIds)
          .gte('business_date', daysAgoJst(30))
          .order('business_date')
      : Promise.resolve({ data: null }),
    // 全店舗のときだけ店舗別の今日
    !store && storeIds.length > 0
      ? supabase
          .from('orders')
          .select('total, guest_count, discount_total, store_id, order_type')
          .in('store_id', storeIds)
          .eq('business_date', today)
          .in('status', SETTLED_ORDER_STATUSES)
      : Promise.resolve({ data: null }),
    !store && storeIds.length > 0
      ? supabase.from('refunds').select('amount, kind, store_id').in('store_id', storeIds).eq('business_date', today)
      : Promise.resolve({ data: null }),
  ]);

  // 本日の予約
  const rows = ((reservationsRes.data ?? []) as unknown as ReservationRow[]).map((r) => ({
    id: r.id,
    time: formatTime(r.start_at),
    name: r.guest_name,
    partySize: r.party_size ?? 0,
    status: r.status,
    assigned: (r.reservation_tables?.length ?? 0) > 0,
    storeName: store ? null : (nameById.get(r.store_id) ?? null),
  }));
  const reservations = reservationsOn ? summarizeOwnerReservations(rows) : null;

  // 30日推移
  const byDate = new Map<string, number>();
  for (const c of closingsRes.data ?? []) {
    byDate.set(c.business_date, (byDate.get(c.business_date) ?? 0) + closingNetSales(c));
  }
  const trend = [...byDate.entries()].map(([date, sales]) => ({ date: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, sales }));

  // 店舗別（全店舗のとき）
  const byStore: NativeOwnerHomePayload['byStore'] = [];
  if (!store) {
    const orders = todayOrdersRes.data ?? [];
    const refunds = todayRefundsRes.data ?? [];
    for (const s of stores) {
      const m = computeSalesMetrics(
        orders.filter((o) => o.store_id === s.id),
        refunds.filter((r) => r.store_id === s.id),
        opts
      );
      byStore.push({ id: s.id, name: s.name, sales: m.netSales, guests: m.guests, groups: m.transactionCount });
    }
    byStore.sort((a, b) => b.sales - a.sales);
  }

  const groups = visibleNavGroups(ctx.role, ctx.disabledFeatures);
  const menu = groups.map((g) => ({
    label: g.label,
    en: g.en ?? null,
    items: g.items
      // ドロア・テイクアウトはその場の操作（レジだけ）。管理画面だけの画面も出さない
      .filter((i) => !i.action && !i.adminOnly && i.href !== '/app/dashboard')
      .map((i) => ({ href: i.href, label: i.label, en: i.en, icon: i.icon })),
  })).filter((g) => g.items.length > 0);
  const nav = MOBILE_NAV.filter((i) => !i.permission || can(ctx.role, i.permission)).map((i) => ({
    href: i.href,
    label: i.label,
    en: i.en,
    icon: i.icon,
  }));

  return {
    store: store ? { id: store.id, name: store.name } : null,
    stores: ctx.stores.map((s) => ({ id: s.id, name: s.name })),
    isHq: ctx.isHq,
    displayName: ctx.displayName,
    serverNow: Date.now(),
    today,
    sales: {
      actual: data.actualSales,
      avgSpend: data.avgSpend,
      budget: data.dailyBudget,
      pct: data.achievementPct,
      ringPct: data.ringPct,
      asOf: salesAsOf,
      date: day.date,
      dayLabel: day.dayLabel,
      heading: day.heading,
      note: day.note,
      canAnalytics: can(ctx.role, 'reports.view'),
    },
    kpis: {
      groups: data.groups,
      groupsYesterday: data.groupsYesterday,
      guests: data.guests,
      guestsYesterday: data.guestsYesterday,
      repeaters: data.repeat.ratePct != null ? data.repeat.repeaters : null,
      walkIns: data.walkIns,
    },
    noticeCount: data.unreadCount + data.alertCount + data.autoNotices.length,
    reservations,
    trend,
    byStore,
    nav,
    menu,
  };
}
