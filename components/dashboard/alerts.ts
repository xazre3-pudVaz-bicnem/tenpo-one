/**
 * 本社ダッシュボード・店舗ダッシュボード共通のアラート収集。
 * 該当するものだけを返す（呼び出し側は空配列なら何も表示しない）。
 * 各アラートは該当画面への絞込リンクを持つ。
 * 閾値は alert_rules（店舗override > 企業既定 > コード既定値）から解決する（components/dashboard/alert-rules.ts）。
 */
import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst, todayJst, weekdayJa } from '@/lib/format';
import { addDaysStr, mondayOfStr } from '@/components/reports/period';
import { UNPAID_INVOICE_STATUSES } from '@/components/invoices/labels';
import { OCCUPYING_STATUSES } from '@/components/reservations/constants';
import { calcWasteAmount } from '@/lib/costing';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { loadResolvedThresholds } from './alert-rules';

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
    pendingLeaveRes,
    openEntriesRes,
    lowStockRes,
    wasteRes,
    refundsRes,
    weekOrdersRes,
    weekOrderItemsRes,
    weekTimeEntriesRes,
    payrollRulesRes,
    tablesRes,
    upcomingReservationsRes,
    shiftReqRes,
    upcomingShiftsRes,
    thresholdsByStore,
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
      .from('attendance_correction_requests')
      .select('id', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('status', 'pending'),
    supabase
      .from('leave_requests')
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
      .gte('business_date', weekAgo)
      .lte('business_date', yesterday),
    supabase.from('refunds').select('store_id').in('store_id', storeIds).gte('business_date', weekAgo).lte('business_date', today),
    supabase
      .from('orders')
      .select('id, store_id, total, discount_total, status, business_date')
      .in('store_id', storeIds)
      .in('status', ['paid', 'refunded'])
      .gte('business_date', weekAgo)
      .lte('business_date', today),
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, store_id, menu_items(cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', weekAgo)
      .lte('orders.business_date', today),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', weekAgo)
      .lte('work_date', today),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', organizationId)
      .eq('status', 'active'),
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
    loadResolvedThresholds(supabase, organizationId, storeIds),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  // ---- 売上低下: 昨日の売上が過去4週同曜日平均のX%未満（既定70%・alert_rules: sales_drop_percent） ----
  const closings = closingsRes.data ?? [];
  const targetWeekday = weekdayJa(yesterday);
  const compareDates = [7, 14, 21, 28].map((n) => daysAgoJst(n));
  for (const s of stores) {
    const rule = thresholdsByStore.get(s.id)?.sales_drop_percent;
    if (!rule?.enabled) continue;
    const yc = closings.find((c) => c.store_id === s.id && c.business_date === yesterday);
    if (!yc) continue;
    const history = closings.filter(
      (c) => c.store_id === s.id && compareDates.includes(c.business_date) && weekdayJa(c.business_date) === targetWeekday
    );
    if (history.length === 0) continue;
    const avg = history.reduce((a, c) => a + c.sales_total, 0) / history.length;
    if (avg > 0 && yc.sales_total < avg * (rule.value / 100)) {
      alerts.push({
        id: `sales-drop-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 昨日の売上が過去4週同曜日平均の${rule.value}%未満です`,
        href: `/app/reports?from=${yesterday}&to=${yesterday}${withStore(s.id)}`,
      });
    }
  }

  // ---- 現金差異（店舗別・過去7日・alert_rules: cash_difference_yen） ----
  for (const s of stores) {
    const rule = thresholdsByStore.get(s.id)?.cash_difference_yen;
    if (!rule?.enabled) continue;
    const overCount = closings.filter(
      (c) => c.store_id === s.id && c.business_date >= weekAgo && Math.abs(c.cash_difference) > rule.value
    ).length;
    if (overCount > 0) {
      alerts.push({
        id: `cash-diff-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 過去7日で現金差異が${rule.value.toLocaleString('ja-JP')}円を超えた日が${overCount}日あります`,
        href: `/app/cash?tab=closings${withStore(s.id)}`,
      });
    }
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

  // ---- 廃棄額（店舗別・過去7日・絶対額・alert_rules: waste_amount_yen） ----
  const wasteMovements = wasteRes.data ?? [];
  for (const s of stores) {
    const rule = thresholdsByStore.get(s.id)?.waste_amount_yen;
    if (!rule?.enabled) continue;
    const wasteAmount = calcWasteAmount(
      wasteMovements.filter((m) => m.store_id === s.id).map((m) => ({ quantity: m.quantity, unitCost: m.unit_cost }))
    );
    if (wasteAmount > rule.value) {
      alerts.push({
        id: `waste-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 過去7日の廃棄額が${rule.value.toLocaleString('ja-JP')}円を超えています（${wasteAmount.toLocaleString('ja-JP')}円）`,
        href: `/app/costing?tab=waste&from=${weekAgo}&to=${today}${withStore(s.id)}`,
      });
    }
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
  const pendingLeaveCount = pendingLeaveRes.count ?? 0;
  if (pendingLeaveCount > 0) {
    alerts.push({
      id: 'pending-leave',
      tone: 'warning',
      title: `承認待ちの有給申請が${pendingLeaveCount}件あります`,
      href: '/app/leave',
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

  // ---- 取消（返金）件数（店舗別・過去7日・alert_rules: void_count） ----
  const refunds = refundsRes.data ?? [];
  for (const s of stores) {
    const rule = thresholdsByStore.get(s.id)?.void_count;
    if (!rule?.enabled) continue;
    const count = refunds.filter((r) => r.store_id === s.id).length;
    if (count > rule.value) {
      alerts.push({
        id: `void-count-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 過去7日の取消（返金）件数が${rule.value}件を超えています（${count}件）`,
        href: `/app/orders?from=${weekAgo}&to=${today}&status=refunded${withStore(s.id)}`,
      });
    }
  }

  // ---- 値引率（店舗別・過去7日・alert_rules: discount_rate_percent） ----
  const weekOrders = weekOrdersRes.data ?? [];
  for (const s of stores) {
    const rule = thresholdsByStore.get(s.id)?.discount_rate_percent;
    if (!rule?.enabled) continue;
    const storeOrders = weekOrders.filter((o) => o.store_id === s.id && o.status === 'paid');
    const sales = storeOrders.reduce((a, o) => a + o.total, 0);
    const discount = storeOrders.reduce((a, o) => a + o.discount_total, 0);
    const base = sales + discount;
    const rate = base > 0 ? (discount / base) * 100 : 0;
    if (base > 0 && rate > rule.value) {
      alerts.push({
        id: `discount-rate-${s.id}`,
        tone: 'warning',
        title: `${s.name}: 過去7日の値引率が${rule.value}%を超えています（${rate.toFixed(1)}%）`,
        href: `/app/orders?from=${weekAgo}&to=${today}${withStore(s.id)}`,
      });
    }
  }

  // ---- 原価率・人件費率（店舗別・過去7日・alert_rules: cost_rate_percent / labor_rate_percent） ----
  const weekOrderItems = weekOrderItemsRes.data ?? [];
  const menuItemIds = [...new Set(weekOrderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);
  const weekTimeEntries = (weekTimeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];

  for (const s of stores) {
    const storeOrders = weekOrders.filter((o) => o.store_id === s.id && o.status === 'paid');
    const sales = storeOrders.reduce((a, o) => a + o.total, 0);
    if (sales <= 0) continue;

    const costRule = thresholdsByStore.get(s.id)?.cost_rate_percent;
    if (costRule?.enabled) {
      const storeItems = weekOrderItems.filter((i) => i.store_id === s.id);
      const costSummary = summarizeItemCosts(storeItems as unknown as CostableOrderItem[], linesByItem);
      const costRate = (costSummary.totalCost / sales) * 100;
      if (costRate > costRule.value) {
        alerts.push({
          id: `cost-rate-${s.id}`,
          tone: 'warning',
          title: `${s.name}: 過去7日の原価率が${costRule.value}%を超えています（${costRate.toFixed(1)}%）`,
          href: `/app/costing?tab=items${withStore(s.id)}`,
        });
      }
    }

    const laborRule = thresholdsByStore.get(s.id)?.labor_rate_percent;
    if (laborRule?.enabled) {
      const storeEntries = weekTimeEntries.filter((e) => e.store_id === s.id);
      const laborResult = estimateLaborCost(storeEntries, payrollRules);
      const laborRate = (laborResult.total / sales) * 100;
      if (laborRate > laborRule.value) {
        alerts.push({
          id: `labor-rate-${s.id}`,
          tone: 'warning',
          title: `${s.name}: 過去7日の人件費率が${laborRule.value}%を超えています（${laborRate.toFixed(1)}%）`,
          href: `/app/payroll${storeParam ? `?store=${s.id}` : ''}`,
        });
      }
    }
  }

  return alerts;
}
