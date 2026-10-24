import 'server-only';
import type { Role } from '@/lib/permissions';
import {
  buildDailyTable,
  canEditMonthlyCosts,
  fixedCostTotal,
  monthWindow,
  profitLoss,
  proratedCosts,
  sumInRange,
  thisWeekWindow,
  type DailyTable,
  type MonthlyCosts,
  type ProfitLoss,
} from '@/lib/monthly-settlement';
import {
  costsReader,
  loadScannedFixedBills,
  loadSettlementSource,
  purchaseLines,
  type InvoiceRow,
  type ScannedFixedBill,
} from '@/app/app/settlement/data';

export interface SettlementStorePl {
  store: { id: string; name: string };
  /** その月の固定費・給料（本部が入れた金額） */
  costs: MonthlyCosts;
  monthPl: ProfitLoss;
  weekPl: ProfitLoss;
}

interface SettlementHead {
  month: string;
  monthLabel: string;
  /** 今月の途中（今日まで） */
  monthInProgress: boolean;
  /** 表に出す月（今日より先は含めない） */
  mw: ReturnType<typeof monthWindow>;
  /** 今週（月曜〜今日） */
  ww: ReturnType<typeof thisWeekWindow>;
  canEdit: boolean;
}

export type SettlementView =
  /** レジ端末のアカウント（管理画面だけ。レジ iPad には出さない） */
  | { kind: 'register' }
  | { kind: 'noStores' }
  /** 本部で「全店舗」：店ごとの今月・今週の損益 */
  | (SettlementHead & { kind: 'all'; perStore: SettlementStorePl[] })
  /** 1 店舗：日ごとの表・固定費と給料・請求書 */
  | (SettlementHead & {
      kind: 'store';
      p: SettlementStorePl;
      table: DailyTable;
      monthInvoices: InvoiceRow[];
      scannedBills: ScannedFixedBill[];
    });

/**
 * 月次清算（/app/settlement）の中身。Web のページと iPad ネイティブ（lib/native-modules/settlement.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadSettlementView(
  ctx: {
    isRegisterDevice?: boolean;
    isHq: boolean;
    role: Role | null;
    currentStore: { id: string; name: string } | null;
    stores: { id: string; name: string }[];
  },
  month: string,
  today: string
): Promise<SettlementView> {
  if (ctx.isRegisterDevice) return { kind: 'register' };

  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  if (targetStores.length === 0) return { kind: 'noStores' };

  const mw = monthWindow(month, today);
  const ww = thisWeekWindow(today);
  const rangeFirst = mw.first < ww.first ? mw.first : ww.first;
  const rangeLast = mw.last > ww.last ? mw.last : ww.last;
  const src = await loadSettlementSource(
    targetStores.map((s) => s.id),
    rangeFirst,
    rangeLast
  );

  const head: SettlementHead = {
    month,
    monthLabel: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`,
    monthInProgress: mw.inProgress,
    mw,
    ww,
    canEdit: canEditMonthlyCosts(ctx),
  };

  /** 店ごとの 今月・今週 の損益 */
  const perStore = targetStores.map((store) => {
    const sales = src.salesByStore.get(store.id) ?? new Map<string, number>();
    const invoices = src.invoicesByStore.get(store.id) ?? [];
    const expenses = src.expensesByStore.get(store.id) ?? new Map<string, number>();
    const costs = costsReader(src.settingsByStore.get(store.id) ?? null);
    const inRange = (first: string, last: string) => invoices.filter((i) => i.date >= first && i.date <= last);
    const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

    const mc = costs(month);
    const monthPl: ProfitLoss = profitLoss({
      sales: sumInRange(sales, mw.first, mw.last),
      purchases: sum(inRange(mw.first, mw.last)),
      expenses: sumInRange(expenses, mw.first, mw.last),
      fixed: fixedCostTotal(mc),
      salary: mc.salary,
    });
    const weekCosts = proratedCosts(ww.dates, costs);
    const weekPl: ProfitLoss = profitLoss({
      sales: sumInRange(sales, ww.first, ww.last),
      purchases: sum(inRange(ww.first, ww.last)),
      expenses: sumInRange(expenses, ww.first, ww.last),
      fixed: weekCosts.fixed,
      salary: weekCosts.salary,
    });
    return { store: { id: store.id, name: store.name }, sales, invoices, expenses, costs: mc, monthPl, weekPl };
  });

  if (!ctx.currentStore) {
    return { ...head, kind: 'all', perStore: perStore.map(({ store, costs, monthPl, weekPl }) => ({ store, costs, monthPl, weekPl })) };
  }

  const p = perStore[0];
  const table = buildDailyTable(mw.dates, p.sales, purchaseLines(p.invoices), p.expenses);
  const monthInvoices = p.invoices.filter((i) => i.date >= mw.first && i.date <= mw.last).sort((a, b) => a.date.localeCompare(b.date));
  const scannedBills = await loadScannedFixedBills(p.store.id, month);
  return {
    ...head,
    kind: 'store',
    p: { store: p.store, costs: p.costs, monthPl: p.monthPl, weekPl: p.weekPl },
    table,
    monthInvoices,
    scannedBills,
  };
}
