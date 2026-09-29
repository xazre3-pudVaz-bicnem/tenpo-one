import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, CalendarCheck, Target } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen, todayJst } from '@/lib/format';
import { monthBounds, diffDaysStr, addDaysStr } from '@/components/reports/period';
import {
  bookingForecast,
  seatOnlyUnitPrices,
  SEAT_ONLY_UNIT_DAYS,
  UPCOMING_RESERVATION_STATUSES,
  type ForecastReservation,
  type SeatOnlyUnit,
  type UnitPriceOrder,
} from '@/lib/booking-forecast';
import { linearLandingForecast } from '@/lib/forecast';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import {
  computeSalesMetrics,
  SETTLED_ORDER_STATUSES,
  type RefundLike,
  type SettledOrderLike,
  type SalesMetricsOptions,
} from '@/lib/metrics';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { BudgetForm, type BudgetFormData } from './budget-form';
import { MonthlyTargetForm } from './monthly-target-form';

export const metadata: Metadata = { title: '予算管理' };

function achievementTone(rate: number | null): BadgeTone {
  if (rate == null) return 'gray';
  if (rate >= 100) return 'success';
  if (rate >= 90) return 'warning';
  return 'danger';
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requirePermission('reports.view');
  const canEdit = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'].includes(ctx.role);
  const supabase = await createClient();

  const sp = await searchParams;
  const today = todayJst();
  const monthParam = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
  // monthBounds(0, date) は date の年月を基準に月初・月末を返す（offset=0固定で選択月自体を対象にする）
  const { first: monthFirst, last: monthLast } = monthBounds(0, monthParam);
  const toDate = today < monthLast ? today : monthLast;
  const elapsedDays = Math.max(1, diffDaysStr(monthFirst, toDate) + 1);
  const daysInMonth = diffDaysStr(monthFirst, monthLast) + 1;

  // ヘッダーの店舗選択に従う: 「全店舗」選択時（本社ロールのみ可能）は全店を対象にする
  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const storeIds = targetStores.map((s) => s.id);
  const showAllStoresRow = !ctx.currentStore;

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="予算管理" />
        <p className="text-sm text-gray-500">アクセス可能な店舗がありません</p>
      </div>
    );
  }

  // 客数KPI設定（organizations.kpi_settings.includeTakeoutGuests。省略時true）。lib/metrics.ts参照
  const { data: orgKpiRow } = await supabase
    .from('organizations')
    .select('kpi_settings')
    .eq('id', ctx.organizationId)
    .maybeSingle();
  const metricsOpts: SalesMetricsOptions = {
    includeTakeoutGuests: (orgKpiRow?.kpi_settings as { includeTakeoutGuests?: boolean } | null)?.includeTakeoutGuests ?? true,
  };

  const [budgetsRes, ordersRes, refundsRes, orderItemsRes, timeEntriesRes, payrollRulesRes, expensesRes] = await Promise.all([
    supabase
      .from('budgets')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .eq('month', monthFirst)
      .or(showAllStoresRow ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : `store_id.in.(${storeIds.join(',')})`),
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id, order_type')
      .in('store_id', storeIds)
      .gte('business_date', monthFirst)
      .lte('business_date', toDate)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id')
      .in('store_id', storeIds)
      .gte('business_date', monthFirst)
      .lte('business_date', toDate),
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, store_id, menu_items(cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', monthFirst)
      .lte('orders.business_date', toDate),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', monthFirst)
      .lte('work_date', toDate),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active'),
    supabase
      .from('expenses')
      .select('amount, store_id')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', monthFirst)
      .lte('business_date', toDate),
  ]);

  const budgets = budgetsRes.data ?? [];
  const budgetByStore = new Map(budgets.map((b) => [b.store_id ?? '__all__', b]));

  const orders = ordersRes.data ?? [];
  const refunds = refundsRes.data ?? [];
  const orderItems = orderItemsRes.data ?? [];
  const timeEntries = (timeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];
  const expenses = expensesRes.data ?? [];

  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

  interface Actual {
    sales: number;
    guests: number;
    avgSpend: number;
    cost: number;
    costRate: number;
    labor: number;
    laborRate: number;
    expense: number;
    profit: number;
  }

  function computeActual(sId: string | null): Actual {
    // 実績は lib/metrics.ts の正式定義（settled=paid+refunded・net=gross−refunds）に統一。
    // ダッシュボード・レポートと同一の関数・同一のクエリ条件（SETTLED_ORDER_STATUSES）を使う。
    const oList = sId ? orders.filter((o) => o.store_id === sId) : orders;
    const rList = sId ? refunds.filter((r) => r.store_id === sId) : refunds;
    const metrics = computeSalesMetrics(oList as SettledOrderLike[], rList as RefundLike[], metricsOpts);
    const sales = metrics.netSales;
    const guests = metrics.guests;
    const avgSpend = metrics.avgSpend;

    const iList = sId ? orderItems.filter((i) => i.store_id === sId) : orderItems;
    const costSummary = summarizeItemCosts(iList as unknown as CostableOrderItem[], linesByItem);
    const costRate = sales > 0 ? (costSummary.totalCost / sales) * 100 : 0;

    const tList = sId ? timeEntries.filter((t) => t.store_id === sId) : timeEntries;
    const laborResult = estimateLaborCost(tList, payrollRules);
    const laborRate = sales > 0 ? (laborResult.total / sales) * 100 : 0;

    const eList = sId ? expenses.filter((e) => e.store_id === sId) : expenses;
    const expenseTotal = eList.reduce((a, e) => a + e.amount, 0);

    const profit = sales - costSummary.totalCost - laborResult.total - expenseTotal;

    return { sales, guests, avgSpend, cost: costSummary.totalCost, costRate, labor: laborResult.total, laborRate, expense: expenseTotal, profit };
  }

  interface Row {
    storeId: string | null;
    storeName: string;
    budget: (typeof budgets)[number] | undefined;
    actual: Actual;
    achievementPct: number | null;
    forecast: number | null;
    forecastPct: number | null;
  }

  const rows: Row[] = [];
  if (showAllStoresRow) {
    const allActual = computeActual(null);
    const allBudget = budgetByStore.get('__all__');
    rows.push({
      storeId: null,
      storeName: '全社',
      budget: allBudget,
      actual: allActual,
      achievementPct: allBudget && allBudget.sales_budget > 0 ? (allActual.sales / allBudget.sales_budget) * 100 : null,
      forecast: linearLandingForecast(allActual.sales, elapsedDays, daysInMonth),
      forecastPct:
        allBudget && allBudget.sales_budget > 0
          ? ((linearLandingForecast(allActual.sales, elapsedDays, daysInMonth) ?? 0) / allBudget.sales_budget) * 100
          : null,
    });
  }
  for (const s of targetStores) {
    const actual = computeActual(s.id);
    const budget = budgetByStore.get(s.id);
    const forecast = linearLandingForecast(actual.sales, elapsedDays, daysInMonth);
    rows.push({
      storeId: s.id,
      storeName: s.name,
      budget,
      actual,
      achievementPct: budget && budget.sales_budget > 0 ? (actual.sales / budget.sales_budget) * 100 : null,
      forecast,
      forecastPct: budget && budget.sales_budget > 0 ? ((forecast ?? 0) / budget.sales_budget) * 100 : null,
    });
  }

  // ── 今月の売上目標（金額入力）とご予約から見込む売上（2026-09-30 Ronnie） ──
  // 対象：ヘッダーで選んだ店舗（全店舗のときは全社）
  const targetRow = rows.find((r) => r.storeId === (ctx.currentStore?.id ?? null)) ?? rows[0];
  const targetEditable =
    canEdit && (targetRow.storeId === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true);
  const isThisMonth = monthFirst.slice(0, 7) === today.slice(0, 7);
  const monthLabel = isThisMonth ? '今月' : `${Number(monthFirst.slice(5, 7))}月`;

  // これからのご予約（本日〜月末。来店済み・会計済みは実績に入っているので入れない）
  const showForecast = monthLast >= today;
  const forecastFrom = today > monthFirst ? today : monthFirst;
  const unitFrom = addDaysStr(today, -SEAT_ONLY_UNIT_DAYS);
  const unitTo = addDaysStr(today, -1);
  let forecast: ReturnType<typeof bookingForecast> | null = null;
  let singleUnit: SeatOnlyUnit | null = null;
  if (showForecast) {
    const [upcomingRes, ...unitOrderResults] = await Promise.all([
      supabase
        .from('reservations')
        .select('store_id, party_size, course_id, menu_items:course_id(price)')
        .in('store_id', storeIds)
        .gte('reserved_date', forecastFrom)
        .lte('reserved_date', monthLast)
        .in('status', [...UPCOMING_RESERVATION_STATUSES])
        .neq('created_via', 'walk_in'),
      // 席のみ客単価：直近7日（昨日まで）の会計。店ごとに取る（1回の取得の上限を超えないように）
      ...storeIds.map((sid) =>
        supabase
          .from('orders')
          .select('store_id, total, guest_count, reservations(party_size, course_id)')
          .eq('store_id', sid)
          .in('status', SETTLED_ORDER_STATUSES)
          .gte('business_date', unitFrom)
          .lte('business_date', unitTo)
      ),
    ]);
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const unitOrders: UnitPriceOrder[] = unitOrderResults.flatMap((res) =>
      (res.data ?? []).map((o) => {
        const rsv = one(o.reservations as { party_size: number; course_id: string | null } | { party_size: number; course_id: string | null }[] | null);
        return {
          storeId: o.store_id,
          total: Number(o.total) || 0,
          guests: (o.guest_count ?? 0) > 0 ? (o.guest_count as number) : (rsv?.party_size ?? 0),
          seatOnlyReservation: rsv ? rsv.course_id == null : null,
        };
      })
    );
    const units = seatOnlyUnitPrices(storeIds, unitOrders);
    const upcoming: ForecastReservation[] = (upcomingRes.data ?? []).map((r) => {
      const course = one(r.menu_items as { price: number } | { price: number }[] | null);
      return {
        storeId: r.store_id,
        partySize: r.party_size,
        coursePrice: r.course_id ? (course?.price ?? null) : null,
      };
    });
    forecast = bookingForecast(upcoming, units);
    singleUnit = storeIds.length === 1 ? (units.get(storeIds[0]) ?? null) : null;
  }
  const landing = forecast ? targetRow.actual.sales + forecast.total : null;
  const targetAmount = targetRow.budget?.sales_budget ?? null;

  return (
    <div>
      <PageHeader
        title="予算管理"
        description="月別・店舗別の予算設定と実績・着地予測の比較"
        actions={
          <Link
            href={`/app/budgets/daily?month=${monthFirst.slice(0, 7)}`}
            className="tap3d inline-flex items-center gap-1.5 rounded-xl bg-plum px-4 py-2 text-[13px] font-bold text-white"
          >
            <CalendarDays className="h-4 w-4" />
            日別予算登録
            <span className="text-[10px] font-semibold opacity-70">Daily</span>
          </Link>
        }
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="month">対象月</Label>
          <Input id="month" name="month" type="month" defaultValue={monthFirst.slice(0, 7)} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          表示する
        </Button>
      </form>

      <p className="mb-3 text-xs text-gray-500">
        経過{elapsedDays}日／{daysInMonth}日（{monthFirst.slice(0, 7).replaceAll('-', '/')}）。着地予測 = 実績 ÷ 経過日数 × 月日数（lib/forecast.ts の線形予測）。
      </p>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* 今月の売上目標（金額を入れて保存） */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-navy">
                <Target className="h-4 w-4 text-iris" aria-hidden />
                {monthLabel}の売上目標
                <span className="text-[11px] font-semibold text-ink-3">Monthly sales target</span>
              </h2>
              <span className="text-xs text-ink-3">
                {targetRow.storeName}｜{monthFirst.slice(0, 7).replaceAll('-', '/')}
              </span>
            </div>
            {targetEditable ? (
              <MonthlyTargetForm
                key={`${targetRow.storeId ?? 'all'}-${monthFirst}`}
                storeId={targetRow.storeId}
                month={monthFirst}
                current={targetAmount}
              />
            ) : (
              <p className="text-2xl font-bold text-ink tabular-nums">{targetAmount != null ? yen(targetAmount) : '未設定'}</p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-lilac-soft px-3 py-2">
                <dt className="text-[11px] text-ink-3">実績（純売上）<span className="ml-1">Sales</span></dt>
                <dd className="text-lg font-bold text-saffron tabular-nums">{yen(targetRow.actual.sales)}</dd>
              </div>
              <div className="rounded-xl bg-lilac-soft px-3 py-2">
                <dt className="text-[11px] text-ink-3">達成率<span className="ml-1">Achievement</span></dt>
                <dd className="text-lg font-bold text-royal tabular-nums">
                  {targetRow.achievementPct != null ? `${targetRow.achievementPct.toFixed(1)}%` : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* ご予約から見込む売上（自動計算） */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-navy">
                <CalendarCheck className="h-4 w-4 text-iris" aria-hidden />
                ご予約から見込む売上
                <span className="text-[11px] font-semibold text-ink-3">Booking forecast</span>
              </h2>
              <Badge tone="navy">自動計算</Badge>
            </div>
            {forecast ? (
              <>
                <p className="text-xs text-ink-3">
                  {forecastFrom.slice(5).replace('-', '/')}〜{monthLast.slice(5).replace('-', '/')} に入っているご予約（キャンセル・来店済みを除く）
                </p>
                <dl className="divide-y divide-line rounded-xl border border-line text-sm">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt>
                      コースのご予約
                      <span className="ml-1.5 text-xs text-ink-3 tabular-nums">
                        {forecast.course.count}件・{forecast.course.guests}名
                      </span>
                      <span className="block text-[11px] text-ink-3">コースの金額 × 人数</span>
                    </dt>
                    <dd className="font-bold tabular-nums">{yen(forecast.course.amount)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt>
                      席のみのご予約
                      <span className="ml-1.5 text-xs text-ink-3 tabular-nums">
                        {forecast.seatOnly.count}件・{forecast.seatOnly.guests}名
                      </span>
                      <span className="block text-[11px] text-ink-3">
                        {singleUnit
                          ? singleUnit.basis === 'seat_only'
                            ? `席のみ客単価 ${yen(singleUnit.unit)} × 人数（直近${SEAT_ONLY_UNIT_DAYS}日の席のみ ${singleUnit.samples}組の平均）`
                            : singleUnit.basis === 'store'
                              ? `客単価 ${yen(singleUnit.unit)} × 人数（直近${SEAT_ONLY_UNIT_DAYS}日に席のみが無いため店全体の平均）`
                              : `直近${SEAT_ONLY_UNIT_DAYS}日の会計が無いため計算できません`
                          : `店舗ごとの席のみ客単価（直近${SEAT_ONLY_UNIT_DAYS}日の平均）× 人数`}
                      </span>
                    </dt>
                    <dd className="font-bold tabular-nums">{yen(forecast.seatOnly.amount)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-iris-soft/60 px-3 py-2">
                    <dt className="font-bold text-navy">予約見込み 合計</dt>
                    <dd className="text-lg font-extrabold text-royal tabular-nums">{yen(forecast.total)}</dd>
                  </div>
                </dl>
                {landing != null && (
                  <p className="text-sm text-ink-2">
                    実績 {yen(targetRow.actual.sales)} ＋ 予約見込み {yen(forecast.total)} ＝{' '}
                    <b className="text-navy tabular-nums">{yen(landing)}</b>
                    {targetAmount != null && targetAmount > 0 && (
                      <Badge className="ml-1.5" tone={achievementTone((landing / targetAmount) * 100)}>
                        目標の {((landing / targetAmount) * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-3">過去の月のため、これからのご予約はありません</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>店舗</Th>
                  <Th className="text-right">売上予算</Th>
                  <Th className="text-right">売上実績（純）</Th>
                  <Th className="text-right">達成率</Th>
                  <Th className="text-right">着地予測</Th>
                  <Th className="text-right">原価率(目標/実績)</Th>
                  <Th className="text-right">人件費率(目標/実績)</Th>
                  <Th className="text-right">利益(目標/実績)</Th>
                  <Th className="text-right">客数(目標/実績)</Th>
                  <Th className="text-right">客単価(目標/実績)</Th>
                  {canEdit && <Th />}
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const editable = canEdit && (r.storeId === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true);
                  const formData: BudgetFormData = {
                    storeId: r.storeId,
                    storeName: r.storeName,
                    month: monthFirst,
                    salesBudget: r.budget?.sales_budget ?? 0,
                    costRateTarget: r.budget?.cost_rate_target ?? null,
                    laborRateTarget: r.budget?.labor_rate_target ?? null,
                    profitTarget: r.budget?.profit_target ?? null,
                    guestsTarget: r.budget?.guests_target ?? null,
                    avgSpendTarget: r.budget?.avg_spend_target ?? null,
                    note: r.budget?.note ?? null,
                  };
                  return (
                    <Tr key={r.storeId ?? '__all__'}>
                      <Td className="font-medium text-navy">
                        {r.storeName}
                        {r.storeId === null && <Badge className="ml-2" tone="navy">全社</Badge>}
                      </Td>
                      <Td className="text-right tabular-nums">{r.budget ? yen(r.budget.sales_budget) : '—'}</Td>
                      <Td className="text-right tabular-nums font-semibold text-navy">{yen(r.actual.sales)}</Td>
                      <Td className="text-right tabular-nums">
                        {r.achievementPct == null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <Badge tone={achievementTone(r.achievementPct)}>{r.achievementPct.toFixed(1)}%</Badge>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.forecast == null ? (
                          '—'
                        ) : (
                          <span>
                            {yen(r.forecast)}
                            {r.forecastPct != null && (
                              <Badge className="ml-1.5" tone={achievementTone(r.forecastPct)}>
                                {r.forecastPct.toFixed(0)}%
                              </Badge>
                            )}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.cost_rate_target != null ? `${r.budget.cost_rate_target}%` : '—'} / {r.actual.costRate.toFixed(1)}%
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.labor_rate_target != null ? `${r.budget.labor_rate_target}%` : '—'} / {r.actual.laborRate.toFixed(1)}%
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.profit_target != null ? yen(r.budget.profit_target) : '—'} / {yen(r.actual.profit)}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.guests_target ?? '—'} / {r.actual.guests}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.avg_spend_target != null ? yen(r.budget.avg_spend_target) : '—'} / {yen(r.actual.avgSpend)}
                      </Td>
                      {canEdit && <Td>{editable ? <BudgetForm data={formData} /> : <span className="text-xs text-gray-300">—</span>}</Td>}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-gray-400">
        ※ 売上実績は純売上（会計成立注文の合計 − 期間内の返金額）。原価・人件費は「レポート」画面と同じ概算ロジック（原価はレシピ原価優先、人件費は時給ルール×実働時間の概算）。全社行は本社管理者（org_owner/hq_admin）のみ編集できます。
        {metricsOpts.includeTakeoutGuests === false && '　客数は店内飲食（テーブル会計・コース）のみで算出しています（設定 > 企業情報 > KPI設定）。'}
      </p>
    </div>
  );
}
