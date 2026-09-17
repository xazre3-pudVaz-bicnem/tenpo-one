/**
 * ホーム画面上段（お知らせ・予算達成率・KPI行）のデータ取得。
 * 店舗表示・全店舗表示（本社）で共通。RLS 適用のセッションクライアントで読み取りのみ行う。
 * 件数の算出などの純ロジックは lib/home-todos.ts。
 */
import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst } from '@/lib/format';
import { UNPAID_INVOICE_STATUSES } from '@/components/invoices/labels';
import { stockWarningLevel } from '@/components/inventory/labels';
import { ACCOUNTING_WRITE_ROLES } from '@/components/accounting/roles';
import type { Role } from '@/lib/permissions';
import {
  computeSalesMetrics,
  SETTLED_ORDER_STATUSES,
  type RefundLike,
  type SalesMetricsOptions,
  type SettledOrderLike,
} from '@/lib/metrics';
import {
  budgetAchievement,
  buildHomeTodos,
  buildRegisterDiffNotices,
  countReservationTodos,
  countUnscannedWithdrawals,
  dailyBudgetFromMonthly,
  findUnclosedPreviousMonth,
  pettyAdvanceBalance,
  PETTY_ADVANCE_KINDS,
  RECEIPT_REQUIRED_KINDS,
  summarizeRepeatRate,
  type AutoNotice,
  type HomeTodo,
  type RepeatSummary,
} from '@/lib/home-todos';
import { collectDashboardAlerts, type DashboardAlert } from './alerts';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface StoreRef {
  id: string;
  name: string;
}

export interface HomeAnnouncement {
  id: string;
  title: string;
  createdAt: string;
  important: boolean;
  unread: boolean;
}

export interface HomeData {
  announcements: HomeAnnouncement[];
  unreadCount: number;
  autoNotices: AutoNotice[];
  todos: HomeTodo[];
  /** 実績（本日の会計済み純売上 + 未会計の注文合計） */
  actualSales: number;
  openSales: number;
  dailyBudget: number | null;
  achievementPct: number | null;
  ringPct: number;
  groups: number;
  groupsYesterday: number;
  guests: number;
  guestsYesterday: number;
  avgSpend: number;
  repeat: RepeatSummary;
  lowStock: { count: number; names: string[] };
  /** 天気の地点に使う住所 */
  address: string | null;
}

/** 自動検知として出すアラートの除外（「今日のやること」と重複するもの） */
const ALERT_IDS_COVERED_BY_TODOS = [/^overdue-invoices$/, /^low-stock-/];

/** お知らせ行の表示時刻（'今日 06:00' / '9/15 21:42'） */
function noticeTime(iso: string, today: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const time = d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  if (date === today) return `今日 ${time}`;
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${time}`;
}

export async function loadHomeData({
  supabase,
  organizationId,
  userId,
  role,
  accountingEnabled,
  stores,
  isAllStores,
  today,
  metricsOpts,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  role: Role | null;
  accountingEnabled: boolean;
  stores: StoreRef[];
  isAllStores: boolean;
  today: string;
  metricsOpts: SalesMetricsOptions;
}): Promise<HomeData> {
  const storeIds = stores.map((s) => s.id);
  const storeIn = storeIds.join(',');
  const yesterday = daysAgoJst(1);
  const recentFrom = daysAgoJst(3);
  const monthFirst = `${today.slice(0, 7)}-01`;
  const canAccounting = accountingEnabled && !!role && ACCOUNTING_WRITE_ROLES.includes(role);

  const [
    todayOrdersRes,
    todayRefundsRes,
    yesterdayOrdersRes,
    yesterdayRefundsRes,
    openOrdersRes,
    budgetsRes,
    announcementsRes,
    registerSessionsRes,
    withdrawalsRes,
    pettyRes,
    inboxRes,
    overdueRes,
    reservationsRes,
    inventoryRes,
    periodsRes,
    storeAddressRes,
    alerts,
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id, order_type, customer_id')
      .in('store_id', storeIds)
      .eq('business_date', today)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase.from('refunds').select('amount, kind, store_id, business_date').in('store_id', storeIds).eq('business_date', today),
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id, order_type')
      .in('store_id', storeIds)
      .eq('business_date', yesterday)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase.from('refunds').select('amount, kind, store_id, business_date').in('store_id', storeIds).eq('business_date', yesterday),
    supabase.from('orders').select('total').in('store_id', storeIds).eq('business_date', today).eq('status', 'open'),
    supabase
      .from('budgets')
      .select('store_id, sales_budget')
      .eq('organization_id', organizationId)
      .eq('month', monthFirst)
      .or(`store_id.is.null,store_id.in.(${storeIn})`),
    supabase
      .from('announcements')
      .select('id, title, created_at, is_important, publish_from, publish_to')
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.in.(${storeIn})`)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('register_sessions')
      .select('business_date, closed_at, difference, store_id, registers(name)')
      .in('store_id', storeIds)
      .gte('business_date', yesterday)
      .not('closed_at', 'is', null)
      .not('difference', 'is', null)
      .neq('difference', 0)
      .order('closed_at', { ascending: false })
      .limit(5),
    supabase
      .from('cash_transactions')
      .select('kind, receipt_document_id, status, approval_status')
      .in('store_id', storeIds)
      .in('kind', [...RECEIPT_REQUIRED_KINDS])
      .eq('status', 'active')
      .gte('business_date', recentFrom)
      .lte('business_date', today)
      .is('receipt_document_id', null),
    supabase
      .from('cash_transactions')
      .select('kind, amount')
      .in('store_id', storeIds)
      .in('kind', [...PETTY_ADVANCE_KINDS])
      .eq('approval_status', 'approved'),
    (() => {
      const q = supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'inbox');
      return isAllStores ? q : q.or(`store_id.is.null,store_id.in.(${storeIn})`);
    })(),
    (() => {
      const q = supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .lt('due_date', today)
        .in('status', UNPAID_INVOICE_STATUSES);
      return isAllStores ? q : q.or(`store_id.is.null,store_id.in.(${storeIn})`);
    })(),
    supabase
      .from('reservations')
      .select('status, reservation_tables(table_id)')
      .in('store_id', storeIds)
      .eq('reserved_date', today)
      .in('status', ['pending', 'confirmed'])
      .limit(500),
    supabase
      .from('inventory_items')
      .select('name, current_quantity, min_quantity, reorder_point')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .or('reorder_point.not.is.null,min_quantity.not.is.null')
      .limit(1000),
    canAccounting
      ? supabase.from('accounting_periods').select('month, status').eq('organization_id', organizationId)
      : Promise.resolve({ data: [] as { month: string; status: string }[] }),
    supabase.from('stores').select('address').in('id', storeIds.slice(0, 1)).maybeSingle(),
    collectDashboardAlerts(supabase, organizationId, stores, isAllStores),
  ]);

  // ---- 売上・客数 ----
  const todayOrders = todayOrdersRes.data ?? [];
  const todayMetrics = computeSalesMetrics(todayOrders as SettledOrderLike[], (todayRefundsRes.data ?? []) as RefundLike[], metricsOpts);
  const yMetrics = computeSalesMetrics(
    (yesterdayOrdersRes.data ?? []) as SettledOrderLike[],
    (yesterdayRefundsRes.data ?? []) as RefundLike[],
    metricsOpts
  );
  const openSales = (openOrdersRes.data ?? []).reduce((a, o) => a + (o.total ?? 0), 0);
  const actualSales = todayMetrics.netSales + openSales;

  // ---- 予算（月予算の日割り。店舗表示は店舗行、全店舗は全社行→無ければ店舗行の合算） ----
  const budgetRows = budgetsRes.data ?? [];
  let monthly: number | null;
  if (isAllStores) {
    const orgRow = budgetRows.find((b) => b.store_id === null);
    const sum = budgetRows.filter((b) => b.store_id !== null).reduce((a, b) => a + b.sales_budget, 0);
    monthly = orgRow?.sales_budget ?? (sum > 0 ? sum : null);
  } else {
    monthly = budgetRows.filter((b) => b.store_id !== null).reduce((a, b) => a + b.sales_budget, 0) || null;
  }
  const dailyBudget = dailyBudgetFromMonthly(monthly, today);
  const achievement = budgetAchievement(actualSales, dailyBudget);

  // ---- リピーター率 ----
  const customerIds = [...new Set(todayOrders.map((o) => o.customer_id).filter((v): v is string => !!v))];
  const { data: customerRows } =
    customerIds.length > 0
      ? await supabase.from('customers').select('id, first_visit_at, visit_count').in('id', customerIds)
      : { data: [] as { id: string; first_visit_at: string | null; visit_count: number }[] };
  const repeat = summarizeRepeatRate(
    todayOrders.map((o) => o.customer_id),
    (customerRows ?? []).map((c) => ({
      id: c.id,
      visit_count: c.visit_count,
      first_visit_date: c.first_visit_at ? new Date(c.first_visit_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : null,
    })),
    today
  );

  // ---- お知らせ（本部・オーナー） ----
  // 公開期間内のもの（components/dashboard/announcement-banner.tsx と同じ判定）
  const annRows = (announcementsRes.data ?? [])
    .filter((a) => !(a.publish_from && today < a.publish_from) && !(a.publish_to && today > a.publish_to))
    .slice(0, 10);
  const annIds = annRows.map((a) => a.id);
  const { data: readRows } =
    annIds.length > 0
      ? await supabase.from('announcement_reads').select('announcement_id').eq('profile_id', userId).in('announcement_id', annIds)
      : { data: [] as { announcement_id: string }[] };
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id));
  const announcements: HomeAnnouncement[] = annRows
    .map((a) => ({
      id: a.id,
      title: a.title,
      createdAt: noticeTime(a.created_at, today),
      important: a.is_important,
      unread: !readSet.has(a.id),
    }))
    // 未読を先に（同順位は新しい順のまま）
    .sort((a, b) => Number(b.unread) - Number(a.unread));
  const unreadCount = announcements.filter((a) => a.unread).length;

  // ---- 自動検知（ルール判定） ----
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const registerNotices = buildRegisterDiffNotices(
    (registerSessionsRes.data ?? []).map((r) => ({
      business_date: r.business_date,
      closed_at: r.closed_at,
      difference: r.difference,
      store_name: isAllStores ? (storeName.get(r.store_id) ?? null) : null,
      register_name: (r.registers as unknown as { name: string } | null)?.name ?? null,
      at: r.closed_at ? noticeTime(r.closed_at, today) : undefined,
    }))
  );
  const alertNotices: AutoNotice[] = (alerts as DashboardAlert[])
    .filter((a) => !ALERT_IDS_COVERED_BY_TODOS.some((re) => re.test(a.id)))
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1))
    .map((a) => ({ id: a.id, message: a.title, linkLabel: '確認する', href: a.href }));
  const autoNotices = [...registerNotices, ...alertNotices];

  // ---- 今日のやること ----
  const lowStockRows = (inventoryRes.data ?? []).filter(
    (i) =>
      stockWarningLevel({
        currentQuantity: Number(i.current_quantity),
        minQuantity: i.min_quantity != null ? Number(i.min_quantity) : null,
        reorderPoint: i.reorder_point != null ? Number(i.reorder_point) : null,
      }) != null
  );
  const resv = countReservationTodos(
    ((reservationsRes.data ?? []) as unknown as { status: string; reservation_tables: { table_id: string }[] | null }[]).map((r) => ({
      status: r.status,
      table_count: r.reservation_tables?.length ?? 0,
    }))
  );
  const todos = buildHomeTodos({
    today,
    unscannedWithdrawals: countUnscannedWithdrawals(withdrawalsRes.data ?? []),
    pettyAdvanceBalance: pettyAdvanceBalance(pettyRes.data ?? []),
    inboxDocuments: inboxRes.count ?? 0,
    overdueInvoices: overdueRes.count ?? 0,
    pendingReservations: resv.pending,
    unassignedReservations: resv.unassigned,
    lowStockItems: lowStockRows.length,
    unclosedMonth: canAccounting ? findUnclosedPreviousMonth(periodsRes.data ?? [], today) : null,
  });

  return {
    announcements,
    unreadCount,
    autoNotices,
    todos,
    actualSales,
    openSales,
    dailyBudget,
    achievementPct: achievement.pct,
    ringPct: achievement.ringPct,
    groups: todayMetrics.transactionCount,
    groupsYesterday: yMetrics.transactionCount,
    guests: todayMetrics.guests,
    guestsYesterday: yMetrics.guests,
    avgSpend: todayMetrics.guests > 0 ? Math.floor(actualSales / todayMetrics.guests) : 0,
    repeat,
    lowStock: { count: lowStockRows.length, names: lowStockRows.slice(0, 4).map((r) => r.name) },
    address: storeAddressRes.data?.address ?? null,
  };
}
