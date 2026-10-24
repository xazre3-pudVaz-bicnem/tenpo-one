import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type RefundLike, type SettledOrderLike } from '@/lib/metrics';
import { dateOfKey, overallReconStatus, salesReconStatus, type ReconScope, type ReconStatus } from '@/lib/reconciliation';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ReconCashRow {
  id: string;
  businessDate: string;
  storeName: string;
  expectedCash: number | null;
  countedCash: number | null;
  cashDifference: number;
}

export interface ReconInventoryRow {
  id: string;
  name: string;
  unit: string;
  diffQty: number;
  unitCost: number | null;
  diffAmount: number | null;
}

export interface ReconciliationData {
  posNetSales: number;
  paymentsNet: number;
  journalNetSales: number;
  diffPayments: number;
  diffJournal: number;
  /** 自動仕訳が未確定の日の数（会計した伝票がある店×営業日で、確定済みの pos_sales 仕訳が無い日） */
  unconfirmedDayCount: number;
  salesStatus: ReconStatus;
  cashRows: ReconCashRow[];
  /** 差異のある日（新しい順） */
  cashDiffDays: ReconCashRow[];
  expectedCashTotal: number;
  countedCashTotal: number;
  cashDifferenceTotal: number;
  cashStatus: ReconStatus;
  /** 確定済みの棚卸があるか */
  hasStockCounts: boolean;
  inventoryDiffRows: ReconInventoryRow[];
  inventoryDiffAmountTotal: number;
  inventoryStatus: ReconStatus;
  overallStatus: ReconStatus;
}

/**
 * 照合（売上・現金・在庫）の中身。Web の /app/reconciliation と iPad ネイティブ（lib/native-modules/reconciliation.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadReconciliationData(
  supabase: Supabase,
  ctx: { organizationId: string },
  scope: ReconScope
): Promise<ReconciliationData> {
  const { from, to, storeIds } = scope;

  // ---- 基礎データ取得 ----
  const [
    { data: ordersData },
    { data: refundsData },
    { data: paymentsData },
    { data: closingsData },
    { data: accountsData },
    { data: stockCountsData },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total, discount_total, guest_count, status, store_id, business_date')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id, business_date')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('payments')
      .select('amount, store_id, business_date')
      .in('store_id', storeIds)
      .eq('status', 'completed')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('daily_closings')
      .select('id, business_date, store_id, expected_cash, counted_cash, cash_difference, status, stores(name)')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date', { ascending: false }),
    supabase.from('accounts').select('id, code').eq('organization_id', ctx.organizationId).in('code', ['400', '401']),
    supabase
      .from('stock_counts')
      .select('id, store_id, count_date')
      .in('store_id', storeIds)
      .eq('status', 'completed')
      .order('count_date', { ascending: false })
      .limit(200),
  ]);

  const settledOrders = ordersData ?? [];
  const refunds = refundsData ?? [];
  const payments = paymentsData ?? [];
  const closings = closingsData ?? [];

  // -------------------------------------------------------------
  // 1) 売上照合: (a) POS純売上 vs (b) 決済合計 vs (c) 仕訳売上（posted・400/401net）
  // -------------------------------------------------------------
  const salesMetrics = computeSalesMetrics(settledOrders as SettledOrderLike[], refunds as RefundLike[]);
  const posNetSales = salesMetrics.netSales;
  const paymentsTotal = payments.reduce((a, p) => a + (p.amount as number), 0);
  const paymentsNet = paymentsTotal - salesMetrics.refunds;

  const salesAccountIds = (accountsData ?? []).map((a) => a.id as string);
  let journalLinesQuery = supabase
    .from('journal_entry_lines')
    .select('side, amount, journal_entries!inner(source_type, status, entry_date, store_id)')
    .eq('organization_id', ctx.organizationId)
    .in('journal_entries.source_type', ['pos_sales', 'pos_refund'])
    .eq('journal_entries.status', 'posted')
    .gte('journal_entries.entry_date', from)
    .lte('journal_entries.entry_date', to);
  journalLinesQuery =
    storeIds.length === 1
      ? journalLinesQuery.eq('journal_entries.store_id', storeIds[0])
      : journalLinesQuery.in('journal_entries.store_id', storeIds);
  const { data: journalLinesData } =
    salesAccountIds.length > 0 ? await journalLinesQuery.in('account_id', salesAccountIds).limit(20000) : { data: [] };
  const journalNetSales = (journalLinesData ?? []).reduce(
    (a, l) => a + (l.side === 'credit' ? (l.amount as number) : -(l.amount as number)),
    0
  );

  // 仕訳未確定日: settled注文がある店舗×営業日のうち、posted な pos_sales 仕訳が存在しない日
  const requiredKeys = [...new Set(settledOrders.map((o) => `${o.store_id}:${o.business_date}`))];
  const postedKeySet = new Set<string>();
  {
    const CHUNK = 300;
    for (let i = 0; i < requiredKeys.length; i += CHUNK) {
      const chunk = requiredKeys.slice(i, i + CHUNK);
      const { data } = await supabase
        .from('journal_entries')
        .select('source_id')
        .eq('organization_id', ctx.organizationId)
        .eq('source_type', 'pos_sales')
        .eq('status', 'posted')
        .in('source_id', chunk);
      for (const r of data ?? []) postedKeySet.add(r.source_id as string);
    }
  }
  const unconfirmedDates = new Set(requiredKeys.filter((k) => !postedKeySet.has(k)).map(dateOfKey));

  const diffPayments = paymentsNet - posNetSales;
  const diffJournal = journalNetSales - posNetSales;
  const hasSalesData = settledOrders.length > 0 || payments.length > 0;
  const salesStatus = salesReconStatus(hasSalesData, diffPayments, diffJournal);

  // -------------------------------------------------------------
  // 2) 現金照合: daily_closings の理論現金 vs 実現金 vs 差異
  // -------------------------------------------------------------
  const cashRows: ReconCashRow[] = closings.map((c) => ({
    id: c.id as string,
    businessDate: c.business_date as string,
    storeName: (c.stores as unknown as { name: string } | null)?.name ?? '',
    expectedCash: c.expected_cash as number | null,
    countedCash: c.counted_cash as number | null,
    cashDifference: c.cash_difference as number,
  }));
  const expectedCashTotal = cashRows.filter((r) => r.expectedCash != null).reduce((a, r) => a + (r.expectedCash as number), 0);
  const countedCashTotal = cashRows.filter((r) => r.countedCash != null).reduce((a, r) => a + (r.countedCash as number), 0);
  const cashDifferenceTotal = cashRows.reduce((a, r) => a + r.cashDifference, 0);
  const cashDiffDays = cashRows.filter((r) => r.cashDifference !== 0).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const cashStatus: ReconStatus = cashRows.length === 0 ? 'no_data' : cashDiffDays.length === 0 ? 'ok' : 'mismatch';

  // -------------------------------------------------------------
  // 3) 在庫照合: 直近の棚卸（店舗ごと最新の確定分）の差異品目・差異金額
  // -------------------------------------------------------------
  const latestCountByStore = new Map<string, { id: string; countDate: string }>();
  for (const c of stockCountsData ?? []) {
    const sid = c.store_id as string;
    if (!latestCountByStore.has(sid)) latestCountByStore.set(sid, { id: c.id as string, countDate: c.count_date as string });
  }
  const latestCountIds = [...latestCountByStore.values()].map((v) => v.id);
  const { data: countItemsData } =
    latestCountIds.length > 0
      ? await supabase
          .from('stock_count_items')
          .select('id, stock_count_id, difference, counted_quantity, inventory_items(name, unit, avg_cost)')
          .in('stock_count_id', latestCountIds)
      : { data: [] };
  const inventoryDiffRows: ReconInventoryRow[] = (countItemsData ?? [])
    .filter((i) => i.counted_quantity != null && Number(i.difference) !== 0)
    .map((i) => {
      const inv = i.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
      const diffQty = Number(i.difference);
      const unitCost = inv?.avg_cost ?? null;
      const diffAmount = unitCost != null ? Math.round(-diffQty * unitCost) : null;
      return { id: i.id as string, name: inv?.name ?? '不明な品目', unit: inv?.unit ?? '', diffQty, unitCost, diffAmount };
    })
    .sort((a, b) => Math.abs(b.diffAmount ?? 0) - Math.abs(a.diffAmount ?? 0));
  const inventoryDiffAmountTotal = inventoryDiffRows.reduce((a, r) => a + (r.diffAmount ?? 0), 0);
  const inventoryStatus: ReconStatus = latestCountIds.length === 0 ? 'no_data' : inventoryDiffRows.length === 0 ? 'ok' : 'mismatch';

  return {
    posNetSales,
    paymentsNet,
    journalNetSales,
    diffPayments,
    diffJournal,
    unconfirmedDayCount: unconfirmedDates.size,
    salesStatus,
    cashRows,
    cashDiffDays,
    expectedCashTotal,
    countedCashTotal,
    cashDifferenceTotal,
    cashStatus,
    hasStockCounts: latestCountIds.length > 0,
    inventoryDiffRows,
    inventoryDiffAmountTotal,
    inventoryStatus,
    overallStatus: overallReconStatus([salesStatus, cashStatus, inventoryStatus]),
  };
}
