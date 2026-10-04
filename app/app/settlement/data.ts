import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import {
  monthlyCostsFrom,
  sumByDate,
  type MonthlyCosts,
  type PurchaseLine,
} from '@/lib/monthly-settlement';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 1回の取得は 1000 行まで。ページを分けて全部読む（全店×1か月の伝票は 1000 を超える） */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await make(offset, offset + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export interface InvoiceRow {
  id: string;
  storeId: string;
  date: string;
  vendor: string;
  amount: number;
  status: string;
  invoiceNo: string | null;
  dueDate: string | null;
}

export interface ExpenseRow {
  storeId: string;
  date: string;
  amount: number;
}

export interface SettlementSource {
  /** 店ごとの日別の純売上（会計済み − 返金） */
  salesByStore: Map<string, Map<string, number>>;
  invoicesByStore: Map<string, InvoiceRow[]>;
  expensesByStore: Map<string, Map<string, number>>;
  /** 店ごとの store_settings.settings（固定費・給料を読む） */
  settingsByStore: Map<string, unknown>;
}

/**
 * 月次清算に使うデータをまとめて読む（期間は「表に出す月」と「今週」を両方含む範囲）。
 *   売上   … orders（paid＋refunded の total）− refunds（lib/metrics.ts の純売上の定義と同じ）
 *   仕入   … invoices（差戻し以外）。日付は 発行日 → 支払期日 → 登録日 の順で使う
 *   経費   … expenses（有効・却下以外）。「金額」欄（税額は別。請求書・経費の画面と同じ）
 */
export async function loadSettlementSource(storeIds: string[], first: string, last: string): Promise<SettlementSource> {
  const supabase: Supabase = await createClient();
  if (storeIds.length === 0) {
    return { salesByStore: new Map(), invoicesByStore: new Map(), expensesByStore: new Map(), settingsByStore: new Map() };
  }

  const [orders, refunds, invoices, expenses, settingsRes] = await Promise.all([
    fetchAll<{ store_id: string; business_date: string; total: number }>((a, b) =>
      supabase
        .from('orders')
        .select('store_id, business_date, total')
        .in('store_id', storeIds)
        .in('status', SETTLED_ORDER_STATUSES)
        .gte('business_date', first)
        .lte('business_date', last)
        .order('business_date')
        .range(a, b)
    ),
    fetchAll<{ store_id: string; business_date: string; amount: number }>((a, b) =>
      supabase
        .from('refunds')
        .select('store_id, business_date, amount')
        .in('store_id', storeIds)
        .gte('business_date', first)
        .lte('business_date', last)
        .order('business_date')
        .range(a, b)
    ),
    fetchAll<{
      id: string;
      store_id: string | null;
      vendor_name: string;
      invoice_no: string | null;
      issue_date: string | null;
      due_date: string | null;
      amount: number;
      status: string;
      created_at: string;
    }>((a, b) =>
      supabase
        .from('invoices')
        .select('id, store_id, vendor_name, invoice_no, issue_date, due_date, amount, status, created_at')
        .in('store_id', storeIds)
        .neq('status', 'rejected')
        // 発行日の無い請求書（支払期日・登録日で見る）も拾えるよう広めに読み、期間の絞り込みは JS 側で行う
        .or(`and(issue_date.gte.${first},issue_date.lte.${last}),issue_date.is.null`)
        .order('created_at')
        .range(a, b)
    ),
    fetchAll<{ store_id: string; business_date: string; amount: number }>((a, b) =>
      supabase
        .from('expenses')
        .select('store_id, business_date, amount')
        .in('store_id', storeIds)
        .eq('status', 'active')
        .neq('approval_status', 'rejected')
        .gte('business_date', first)
        .lte('business_date', last)
        .order('business_date')
        .range(a, b)
    ),
    supabase.from('store_settings').select('store_id, settings').in('store_id', storeIds),
  ]);

  const salesByStore = new Map<string, Map<string, number>>();
  for (const id of storeIds) {
    const rows = orders.filter((o) => o.store_id === id).map((o) => ({ date: o.business_date, amount: Number(o.total ?? 0) }));
    const back = refunds.filter((r) => r.store_id === id).map((r) => ({ date: r.business_date, amount: -Number(r.amount ?? 0) }));
    salesByStore.set(id, sumByDate([...rows, ...back]));
  }

  const invoicesByStore = new Map<string, InvoiceRow[]>();
  for (const id of storeIds) invoicesByStore.set(id, []);
  for (const inv of invoices) {
    if (!inv.store_id) continue;
    const date = inv.issue_date ?? inv.due_date ?? jstDate(inv.created_at);
    if (date < first || date > last) continue;
    invoicesByStore.get(inv.store_id)?.push({
      id: inv.id,
      storeId: inv.store_id,
      date,
      vendor: inv.vendor_name,
      amount: Number(inv.amount ?? 0),
      status: inv.status,
      invoiceNo: inv.invoice_no,
      dueDate: inv.due_date,
    });
  }

  const expensesByStore = new Map<string, Map<string, number>>();
  for (const id of storeIds) {
    expensesByStore.set(id, sumByDate(expenses.filter((e) => e.store_id === id).map((e) => ({ date: e.business_date, amount: Number(e.amount ?? 0) }))));
  }

  const settingsByStore = new Map<string, unknown>();
  for (const s of settingsRes.data ?? []) settingsByStore.set(s.store_id as string, s.settings);

  return { salesByStore, invoicesByStore, expensesByStore, settingsByStore };
}

/** timestamptz → JST の日付（YYYY-MM-DD） */
function jstDate(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function purchaseLines(rows: readonly InvoiceRow[]): PurchaseLine[] {
  return rows.map((r) => ({ date: r.date, vendor: r.vendor, amount: r.amount }));
}

export function costsReader(settings: unknown): (month: string) => MonthlyCosts {
  const cache = new Map<string, MonthlyCosts>();
  return (month) => {
    let c = cache.get(month);
    if (!c) {
      c = monthlyCostsFrom(settings, month);
      cache.set(month, c);
    }
    return c;
  };
}
