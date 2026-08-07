/**
 * 本社ダッシュボード・店舗ダッシュボード共通のアラート収集。
 * 該当するものだけを返す（呼び出し側は空配列なら何も表示しない）。
 * 各アラートは該当画面への絞込リンクを持つ。
 */
import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst, todayJst, weekdayJa } from '@/lib/format';
import { addDaysStr, mondayOfStr } from '@/components/reports/period';
import { isSpike } from '@/components/reports/compare';
import { UNPAID_INVOICE_STATUSES } from '@/components/invoices/labels';
import { OCCUPYING_STATUSES } from '@/components/reservations/constants';
import { calcWasteAmount } from '@/lib/costing';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface DashboardAlert {
  id: string;
  tone: 'danger' | 'warning';
  title: string;
  href: string;
}

interface StoreRef {
  id: string;
  name: string;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param stores 対象スコープの店舗一覧（店舗モードなら1件）
 * @param storeParam HQ全店舗モードなら遷移先に store=id を付ける（レポート等の店舗別ドリルダウン用）
 */
export async function collectDashboardAlerts(
  supabase: SupabaseClient,
  organizationId: string,
  stores: StoreRef[],
  storeParam: boolean
): Promise<DashboardAlert[]> {
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) return [];

  const alerts: DashboardAlert[] = [];
  const today = todayJst();
  const yesterday = daysAgoJst(1);
  const weekAgo = daysAgoJst(6);
  const twoWeeksAgo = daysAgoJst(13);
  const fourWeeksAgo = daysAgoJst(27);
  const in3Days = addDaysStr(today, 2);
  const in7Days = addDaysStr(today, 6);
  const withStore = (id: string) => (storeParam ? `&store=${id}` : '');

  const [
    closingsRes,
    overdueInvoicesRes,
    pendingInvoicesRes,
    pendingPettyRes,
    pendingAttendanceRes,
    openEntriesRes,
    lowStockRes,
    wasteRes,
    refundsThisWeekRes,
    refundsLastWeekRes,
    discountOrdersRes,
    tablesRes,
    upcomingReservationsRes,
    shiftReqRes,
    upcomingShiftsRes,
  ] = await Promise.all([
    supabase
      .from('daily_closings')
      .select('store_id, business_date, sales_total, cash_difference')
      .in('store_id', storeIds)
      .gte('business_date', fourWeeksAgo)
      .lte('business_date', yesterday),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .lt('due_date', today)
      .in('status', UNPAID_INVOICE_STATUSES),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending_approval'),
    supabase
      .from('cash_transactions')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('approval_status', 'pending'),
    supabase
      .from('attendance_requests')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('status', 'pending'),
    supabase
      .from('time_entries')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .lt('work_date', today)
      .not('clock_in_at', 'is', null)
      .is('clock_out_at', null),
    supabase
      .from('inventory_items')
      .select('id, store_id, current_quantity, reorder_point')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .not('reorder_point', 'is', null),
    supabase
      .from('stock_movements')
      .select('store_id, business_date, quantity, unit_cost')
      .in('store_id', storeIds)
      .eq('movement_type', 'waste')
      .gte('business_date', twoWeeksAgo)
      .lte('business_date', yesterday),
    supabase.from('refunds').select('id', { count: 'exact', head: true }).in('store_id', storeIds).gte('business_date', weekAgo).lte('business_date', today),
    supabase.from('refunds').select('id', { count: 'exact', head: true }).in('store_id', storeIds).gte('business_date', twoWeeksAgo).lt('business_date', weekAgo),
    supabase
      .from('orders')
      .select('discount_total, business_date')
      .in('store_id', storeIds)
      .eq('status', 'paid')
      .gte('business_date', twoWeeksAgo)
      .lte('business_date', today),
    supabase.from('restaurant_tables').select('store_id, capacity_max').in('store_id', storeIds).eq('status', 'active'),
    supabase
      .from('reservations')
      .select('store_id, reserved_date, party_size, status')
      .in('store_id', storeIds)
      .gte('reserved_date', today)
      .lte('reserved_date', in3Days),
    supabase.from('shift_requirements').select('store_id, day_of_week, time_from, time_to, required_count').in('store_id', storeIds),
    supabase
      .from('shifts')
      .select('store_id, shift_date, start_time, end_time, status')
      .in('store_id', storeIds)
      .gte('shift_date', today)
      .lte('shift_date', in7Days)
      .in('status', ['published', 'confirmed']),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  // ---- 売上低下: 昨日の売上が過去4週同曜日平均の70%未満 ----
  const closings = closingsRes.data ?? [];
  const targetWeekday = weekdayJa(yesterday);
  const compareDates = [7, 14, 21, 28].map((n) => daysAgoJst(n));
  for (const s of stores) {
    const yc = closings.find((c) => c.store_id === s.id && c.business_date === yesterday);
    if (!yc) continue;
    const history = closings.filter(
      (c) => c.store_id === s.id && compareDates.includes(c.business_date) && weekdayJa(c.business_date) === targetWeekday
    );
    if (history.length === 0) continue;
    const avg = history.reduce((a, c) => a + c.sales_total, 0) / history.length;
    if (avg > 0 && yc.sales_total < avg * 0.7) {
      alerts.push({
        id: `sales-drop-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 昨日の売上が過去4週同曜日平均の70%未満です`,
        href: `/app/reports?from=${yesterday}&to=${yesterday}${withStore(s.id)}`,
      });
    }
  }

  // ---- 現金差異: 過去7日 ----
  const cashDiffCount = closings.filter((c) => c.business_date >= weekAgo && c.cash_difference !== 0).length;
  if (cashDiffCount > 0) {
    alerts.push({
      id: 'cash-diff',
      tone: 'warning',
      title: `過去7日で現金差異が${cashDiffCount}日発生しています`,
      href: '/app/cash?tab=closings',
    });
  }

  // ---- 在庫不足（店舗別）----
  const lowStockByStore = new Map<string, number>();
  for (const item of lowStockRes.data ?? []) {
    if (item.reorder_point != null && Number(item.current_quantity) <= Number(item.reorder_point)) {
      lowStockByStore.set(item.store_id, (lowStockByStore.get(item.store_id) ?? 0) + 1);
    }
  }
  for (const [storeId, count] of lowStockByStore) {
    alerts.push({
      id: `low-stock-${storeId}`,
      tone: 'warning',
      title: `${storeName.get(storeId) ?? '店舗'}: 在庫不足の品目が${count}件あります`,
      href: '/app/inventory?sort=warning',
    });
  }

  // ---- 廃棄増加: 今週(直近7日) vs 先週(その前7日) ----
  const wasteMovements = wasteRes.data ?? [];
  const wasteThisWeek = calcWasteAmount(
    wasteMovements.filter((m) => m.business_date >= weekAgo).map((m) => ({ quantity: m.quantity, unitCost: m.unit_cost }))
  );
  const wasteLastWeek = calcWasteAmount(
    wasteMovements.filter((m) => m.business_date >= twoWeeksAgo && m.business_date < weekAgo).map((m) => ({ quantity: m.quantity, unitCost: m.unit_cost }))
  );
  if (isSpike(wasteThisWeek, wasteLastWeek, 1.5)) {
    alerts.push({
      id: 'waste-spike',
      tone: 'warning',
      title: `今週の廃棄額が先週比150%を超えています（${wasteLastWeek.toLocaleString('ja-JP')}円→${wasteThisWeek.toLocaleString('ja-JP')}円）`,
      href: `/app/costing?tab=waste&from=${weekAgo}&to=${today}`,
    });
  }

  // ---- 支払期限超過の請求書 ----
  const overdueCount = overdueInvoicesRes.count ?? 0;
  if (overdueCount > 0) {
    alerts.push({
      id: 'overdue-invoices',
      tone: 'danger',
      title: `支払期限を過ぎた請求書が${overdueCount}件あります`,
      href: '/app/invoices?tab=invoices&overdue=1',
    });
  }

  // ---- 未承認: 請求書・小口現金・勤怠修正 ----
  const pendingInvoiceCount = pendingInvoicesRes.count ?? 0;
  if (pendingInvoiceCount > 0) {
    alerts.push({
      id: 'pending-invoices',
      tone: 'warning',
      title: `承認待ちの請求書が${pendingInvoiceCount}件あります`,
      href: '/app/invoices?tab=invoices&status=pending_approval',
    });
  }
  const pendingPettyCount = pendingPettyRes.count ?? 0;
  if (pendingPettyCount > 0) {
    alerts.push({
      id: 'pending-petty',
      tone: 'warning',
      title: `承認待ちの小口現金が${pendingPettyCount}件あります`,
      href: '/app/cash?tab=petty',
    });
  }
  const pendingAttendanceCount = pendingAttendanceRes.count ?? 0;
  if (pendingAttendanceCount > 0) {
    alerts.push({
      id: 'pending-attendance',
      tone: 'warning',
      title: `承認待ちの勤怠修正申請が${pendingAttendanceCount}件あります`,
      href: '/app/attendance?tab=requests',
    });
  }

  // ---- 打刻漏れ ----
  const openEntryCount = openEntriesRes.count ?? 0;
  if (openEntryCount > 0) {
    alerts.push({
      id: 'open-entries',
      tone: 'warning',
      title: `退勤未打刻（打刻漏れ）が${openEntryCount}件あります`,
      href: '/app/attendance?tab=list',
    });
  }

  // ---- シフト不足: 今後7日で必要人数を下回る時間帯のある店舗 ----
  const requirements = shiftReqRes.data ?? [];
  const shifts = upcomingShiftsRes.data ?? [];
  const shortfallStores = new Set<string>();
  for (let i = 0; i <= 6; i++) {
    const date = addDaysStr(today, i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const req of requirements) {
      if (req.day_of_week !== dow) continue;
      const reqFrom = timeToMinutes(req.time_from);
      const reqTo = timeToMinutes(req.time_to);
      const covering = shifts.filter(
        (sh) =>
          sh.store_id === req.store_id &&
          sh.shift_date === date &&
          timeToMinutes(sh.start_time) <= reqFrom &&
          timeToMinutes(sh.end_time) >= reqTo
      ).length;
      if (covering < req.required_count) shortfallStores.add(req.store_id);
    }
  }
  for (const storeId of shortfallStores) {
    alerts.push({
      id: `shift-shortfall-${storeId}`,
      tone: 'warning',
      title: `${storeName.get(storeId) ?? '店舗'}: 今後7日に必要人数を下回るシフト時間帯があります`,
      href: `/app/shifts?week=${mondayOfStr(today)}`,
    });
  }

  // ---- 予約過多: 今後3日で予約人数合計が総席数の90%超の日がある店舗 ----
  const tables = tablesRes.data ?? [];
  const seatsByStore = new Map<string, number>();
  for (const t of tables) seatsByStore.set(t.store_id, (seatsByStore.get(t.store_id) ?? 0) + t.capacity_max);
  const reservations = upcomingReservationsRes.data ?? [];
  const overbookedStores = new Set<string>();
  for (const s of stores) {
    const seats = seatsByStore.get(s.id) ?? 0;
    if (seats <= 0) continue;
    for (let i = 0; i <= 2; i++) {
      const date = addDaysStr(today, i);
      const partyTotal = reservations
        .filter((r) => r.store_id === s.id && r.reserved_date === date && OCCUPYING_STATUSES.includes(r.status))
        .reduce((a, r) => a + r.party_size, 0);
      if (partyTotal > seats * 0.9) {
        overbookedStores.add(s.id);
        break;
      }
    }
  }
  for (const storeId of overbookedStores) {
    alerts.push({
      id: `overbooked-${storeId}`,
      tone: 'warning',
      title: `${storeName.get(storeId) ?? '店舗'}: 今後3日に予約人数が総席数の90%を超える日があります`,
      href: `/app/reservations?date=${today}`,
    });
  }

  // ---- 異常な取消・値引き: 今週(直近7日) vs 先週(その前7日) ----
  const refundsThisWeek = refundsThisWeekRes.count ?? 0;
  const refundsLastWeek = refundsLastWeekRes.count ?? 0;
  if (isSpike(refundsThisWeek, refundsLastWeek, 2)) {
    alerts.push({
      id: 'refund-spike',
      tone: 'warning',
      title: `今週の返金件数が先週比200%を超えています（${refundsLastWeek}件→${refundsThisWeek}件）`,
      href: `/app/orders?from=${weekAgo}&to=${today}&status=refunded`,
    });
  }
  const discountOrders = discountOrdersRes.data ?? [];
  const discountThisWeek = discountOrders.filter((o) => o.business_date >= weekAgo).reduce((a, o) => a + o.discount_total, 0);
  const discountLastWeek = discountOrders
    .filter((o) => o.business_date >= twoWeeksAgo && o.business_date < weekAgo)
    .reduce((a, o) => a + o.discount_total, 0);
  if (isSpike(discountThisWeek, discountLastWeek, 2)) {
    alerts.push({
      id: 'discount-spike',
      tone: 'warning',
      title: `今週の値引き額合計が先週比200%を超えています（${discountLastWeek.toLocaleString('ja-JP')}円→${discountThisWeek.toLocaleString('ja-JP')}円）`,
      href: `/app/orders?from=${weekAgo}&to=${today}`,
    });
  }

  return alerts;
}
