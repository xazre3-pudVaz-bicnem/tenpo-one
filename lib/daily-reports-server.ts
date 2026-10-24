import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { StoreRef } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
import { daysAgoJst, todayJst } from '@/lib/format';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 日報を生成・提出できるロール（daily_reports の write RLS と同じ。app/app/daily-reports/actions.ts と一致） */
export const DAILY_REPORT_WRITE_ROLES: readonly Role[] = ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'];
/** 承認できるロール（本社寄り） */
export const DAILY_REPORT_APPROVE_ROLES: readonly Role[] = ['org_owner', 'hq_admin', 'area_manager'];

export interface DailyReportsSearch {
  date?: string;
  from?: string;
  to?: string;
  store?: string;
  status?: string;
}

export interface DailyReportDayRow {
  store: StoreRef;
  /** 対象日の日報（無ければ null） */
  report: { id: string; status: string } | null;
  /** レジ締め済みか */
  closed: boolean;
}

export interface DailyReportHistoryRow {
  id: string;
  storeId: string;
  storeName: string;
  businessDate: string;
  status: string;
}

export interface DailyReportsPageData {
  today: string;
  date: string;
  targetStores: StoreRef[];
  canWrite: boolean;
  canApprove: boolean;
  rows: DailyReportDayRow[];
  histFrom: string;
  histTo: string;
  history: DailyReportHistoryRow[];
}

/**
 * 日報の画面の中身。Web の /app/daily-reports と iPad ネイティブ（lib/native-modules/daily-reports.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadDailyReportsPage(
  ctx: { role: Role | null; currentStore: StoreRef | null; stores: StoreRef[] },
  supabase: Supabase,
  sp: DailyReportsSearch
): Promise<DailyReportsPageData> {
  const today = todayJst();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : daysAgoJst(1);

  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const storeIds = targetStores.map((s) => s.id);
  const canWrite = ctx.role != null && DAILY_REPORT_WRITE_ROLES.includes(ctx.role);
  const canApprove = ctx.role != null && DAILY_REPORT_APPROVE_ROLES.includes(ctx.role);

  const [reportsRes, closingsRes] = await Promise.all([
    storeIds.length > 0
      ? supabase.from('daily_reports').select('id, store_id, status').in('store_id', storeIds).eq('business_date', date)
      : Promise.resolve({ data: [] }),
    storeIds.length > 0
      ? supabase.from('daily_closings').select('store_id').in('store_id', storeIds).eq('business_date', date)
      : Promise.resolve({ data: [] }),
  ]);
  const reportByStore = new Map(
    ((reportsRes.data ?? []) as { id: string; store_id: string; status: string }[]).map((r) => [r.store_id, r])
  );
  const closedStores = new Set(((closingsRes.data ?? []) as { store_id: string }[]).map((c) => c.store_id));
  const rows: DailyReportDayRow[] = targetStores.map((s) => {
    const r = reportByStore.get(s.id);
    return { store: s, report: r ? { id: r.id, status: r.status } : null, closed: closedStores.has(s.id) };
  });

  // ---- 過去日報の検索 ----
  const histFrom = sp.from || daysAgoJst(29);
  const histTo = sp.to || today;
  let histQuery = supabase
    .from('daily_reports')
    .select('id, store_id, business_date, status, stores(name)')
    .in('store_id', storeIds.length > 0 ? storeIds : ['00000000-0000-0000-0000-000000000000'])
    .gte('business_date', histFrom)
    .lte('business_date', histTo)
    .order('business_date', { ascending: false })
    .limit(200);
  if (sp.store) histQuery = histQuery.eq('store_id', sp.store);
  if (sp.status) histQuery = histQuery.eq('status', sp.status);
  const { data: historyData } = await histQuery;
  const history: DailyReportHistoryRow[] = (historyData ?? []).map((r) => ({
    id: r.id as string,
    storeId: r.store_id as string,
    storeName: (r.stores as unknown as { name: string } | null)?.name ?? '不明',
    businessDate: r.business_date as string,
    status: r.status as string,
  }));

  return { today, date, targetStores, canWrite, canApprove, rows, histFrom, histTo, history };
}
