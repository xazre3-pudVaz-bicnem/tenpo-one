import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type SalesMetricsOptions } from '@/lib/metrics';
import { loadExpectedOpening, loadStoreDay } from '@/lib/register-day-server';
import { registerDayFlowActive } from '@/lib/register-day';
import { cleanRegisterName, pickMainRegister } from '@/lib/register-name';
import { loadStoreClerks } from '@/lib/pos-clerks-server';
import { loadRegisterBoard, loadTodayCashRows, receiptStateOf } from '@/app/app/cash/close/data';
import { splitPurpose } from '@/components/cash/cash-history';
import { METHOD_LABELS, METHOD_LABELS_EN } from '@/components/cash/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 支払方法別の表で常に出す方法（Web の app/app/cash/close/page.tsx の BASE_METHODS と同じ） */
const BASE_METHODS = ['cash', 'credit', 'qr', 'emoney'];

/**
 * iPad アプリのネイティブのレジ開局・レジクローズに返すもの（GET /api/app/v1/pos?part=cash）。
 * 中身は Web のレジ開局（app/app/cash/open/page.tsx）と、レジの iPad のレジクローズ（app/app/cash/close/page.tsx の isRegi）と同じ組み立て
 * （2026-10-24 Ronnie「レジの画面は全部ネイティブに。機能と言葉は Web の iPad と同じ」）
 */
export interface NativeCashPayload {
  store: { id: string; name: string };
  /** いまの営業日（開いたままのレジがあれば前の営業日のまま） */
  businessDate: string;
  /** 前の営業日のまま続けている */
  continuing: boolean;
  /** 開局の箱に出す「前回のレジクローズで残した金額」（比べない店は null） */
  expectedOpening: number | null;
  expectedFrom: string | null;
  /** 開局の箱（開いているレジが無いときだけ。店に1つ） */
  openRegister: { id: string; name: string } | null;
  /** 開局中のレジ（現金実査してクローズする） */
  openSessions: {
    id: string;
    registerName: string;
    businessDate: string;
    openedAt: string;
    openedByName: string;
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    cashIn: number;
    cashOut: number;
    theoreticalCash: number;
  }[];
  /** 締めたレジ（再印刷） */
  closedSessions: {
    id: string;
    registerName: string;
    openedByName: string;
    closedByName: string;
    openedAt: string;
    closedAt: string | null;
    openingFloat: number;
    expectedCash: number | null;
    countedCash: number | null;
    difference: number | null;
  }[];
  storeDayClosed: boolean;
  /** 翌準備金の目標（店舗設定。無ければ null＝その日の釣銭準備金） */
  nextFloatSetting: number | null;
  /** 未会計の伝票（クローズさせない） */
  openCount: number;
  openTotal: number;
  /** 本日の売上（会計済） */
  sales: { grossSales: number; refunds: number; netSales: number; transactionCount: number; guests: number; avgSpend: number };
  /** 支払方法別 */
  byMethod: { method: string; label: string; en: string; count: number; amount: number }[];
  paymentsCount: number;
  paymentsTotal: number;
  /** 入出金・現金残り（開局中のレジの合計） */
  cashFlow: { opening: number; sales: number; cashIn: number; cashOut: number; refunds: number; remaining: number; depositCount: number; withdrawalCount: number };
  /** 入出金の明細（新しい 8 件） */
  registerMoves: { id: string; kind: 'deposit' | 'withdrawal'; time: string; main: string; sub: string | null; amount: number }[];
  registerMovesMore: number;
  /** 出金レシートの確認（レシートあり／無し） */
  receipts: { total: number; ok: number; ng: number; ngTotal: number };
  /** レジの担当者（開局・クローズの担当者を選ぶ。Web の担当者ポップアップと同じ名簿） */
  clerks: { id: string; name: string; role: string }[];
  canOperate: boolean;
  canScan: boolean;
  /** レジ端末（締めたらログアウト） */
  isRegisterDevice: boolean;
}

const KIND_FALLBACK: Record<string, string> = { deposit: '入金', withdrawal: '出金' };

export async function loadNativeCash(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeCashPayload> {
  const [storeDay, lastCloseRaw, registersRes, clerks] = await Promise.all([
    loadStoreDay(supabase, store.id),
    loadExpectedOpening(supabase, store.id),
    supabase.from('registers').select('id, name, created_at').eq('store_id', store.id).eq('status', 'active').order('created_at'),
    loadStoreClerks(supabase, store.id),
  ]);
  const today = storeDay.businessDate;
  // 比べるのは REGISTER_DAY_FLOW_FROM（9/29）から（Web の開局画面と同じ）
  const lastClose = registerDayFlowActive(storeDay.clock) ? lastCloseRaw : { ...lastCloseRaw, expected: null };

  const [board, cashRows, { data: settledOrders }, { data: refunds }, { data: openOrders }, { data: payments }, { data: orgKpiRow }] = await Promise.all([
    loadRegisterBoard(store.id, today),
    loadTodayCashRows(store.id, today),
    supabase
      .from('orders')
      .select('total, discount_total, guest_count, status, order_type')
      .eq('store_id', store.id)
      .eq('business_date', today)
      .in('status', [...SETTLED_ORDER_STATUSES])
      .limit(5000),
    supabase.from('refunds').select('amount, kind').eq('store_id', store.id).eq('business_date', today).limit(5000),
    supabase.from('orders').select('id, total').eq('store_id', store.id).eq('business_date', today).eq('status', 'open').limit(1000),
    supabase.from('payments').select('method, amount').eq('store_id', store.id).eq('business_date', today).eq('status', 'completed').limit(10000),
    supabase.from('organizations').select('kpi_settings').eq('id', ctx.organizationId).maybeSingle(),
  ]);

  const metricsOpts: SalesMetricsOptions = {
    includeTakeoutGuests: (orgKpiRow?.kpi_settings as { includeTakeoutGuests?: boolean } | null)?.includeTakeoutGuests ?? true,
  };
  const metrics = computeSalesMetrics(settledOrders ?? [], refunds ?? [], metricsOpts);
  const openCount = (openOrders ?? []).length;
  const openTotal = (openOrders ?? []).reduce((a, o) => a + (o.total as number), 0);

  const byMethod = new Map<string, { count: number; amount: number }>();
  for (const m of BASE_METHODS) byMethod.set(m, { count: 0, amount: 0 });
  for (const p of payments ?? []) {
    const cur = byMethod.get(p.method as string) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += p.amount as number;
    byMethod.set(p.method as string, cur);
  }

  const receiptRows = cashRows.filter((r) => receiptStateOf(r) !== 'none');
  const okRows = receiptRows.filter((r) => receiptStateOf(r) === 'ok');
  const ngRows = receiptRows.filter((r) => receiptStateOf(r) !== 'ok');

  const { openSessions, cards, todayClosing } = board;
  const closedCards = cards.filter((c) => c.type === 'closed');
  const main = pickMainRegister((registersRes.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as string | null })));

  const cashFlow = openSessions.reduce(
    (a, x) => ({
      opening: a.opening + x.openingFloat,
      sales: a.sales + x.cashSales,
      cashIn: a.cashIn + x.cashIn,
      cashOut: a.cashOut + x.cashOut,
      refunds: a.refunds + x.cashRefunds,
      remaining: a.remaining + x.theoreticalCash,
    }),
    { opening: 0, sales: 0, cashIn: 0, cashOut: 0, refunds: 0, remaining: 0 }
  );
  const registerMoves = cashRows
    .filter((r) => r.kind === 'deposit' || r.kind === 'withdrawal')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    store: { id: store.id, name: store.name },
    businessDate: today,
    continuing: storeDay.continuing,
    expectedOpening: lastClose.expected,
    expectedFrom: lastClose.businessDate,
    openRegister: openSessions.length === 0 && main ? { id: main.id, name: cleanRegisterName(main.name) } : null,
    openSessions: openSessions.map((s) => ({
      id: s.id,
      registerName: s.registerName,
      businessDate: s.businessDate,
      openedAt: s.openedAt,
      openedByName: s.openedByName,
      openingFloat: s.openingFloat,
      cashSales: s.cashSales,
      cashRefunds: s.cashRefunds,
      cashIn: s.cashIn,
      cashOut: s.cashOut,
      theoreticalCash: s.theoreticalCash,
    })),
    closedSessions: closedCards.flatMap((c) => (c.type === 'closed' ? [c.session] : [])),
    storeDayClosed: !!todayClosing,
    nextFloatSetting: storeDay.nextFloatSetting,
    openCount,
    openTotal,
    sales: {
      grossSales: metrics.grossSales,
      refunds: metrics.refunds,
      netSales: metrics.netSales,
      transactionCount: metrics.transactionCount,
      guests: metrics.guests,
      avgSpend: metrics.avgSpend,
    },
    byMethod: [...byMethod.entries()]
      .filter(([m, v]) => BASE_METHODS.includes(m) || v.count > 0)
      .map(([method, v]) => ({ method, label: METHOD_LABELS[method] ?? method, en: METHOD_LABELS_EN[method] ?? method, count: v.count, amount: v.amount })),
    paymentsCount: (payments ?? []).length,
    paymentsTotal: (payments ?? []).reduce((a, p) => a + (p.amount as number), 0),
    cashFlow: {
      ...cashFlow,
      depositCount: registerMoves.filter((r) => r.kind === 'deposit').length,
      withdrawalCount: registerMoves.filter((r) => r.kind === 'withdrawal').length,
    },
    registerMoves: registerMoves.slice(-8).map((r) => {
      const { main: m, sub } = splitPurpose(r.purpose, r.kind);
      return { id: r.id, kind: r.kind as 'deposit' | 'withdrawal', time: r.occurredAt, main: m || KIND_FALLBACK[r.kind] || r.kind, sub, amount: r.amount };
    }),
    registerMovesMore: Math.max(0, registerMoves.length - 8),
    receipts: { total: receiptRows.length, ok: okRows.length, ng: ngRows.length, ngTotal: ngRows.reduce((a, r) => a + r.amount, 0) },
    clerks: clerks.map((c) => ({ id: c.id, name: c.name, role: String(c.role) })),
    canOperate: can(ctx.role, 'register.operate'),
    canScan: can(ctx.role, 'documents.write') && can(ctx.role, 'cash.write'),
    isRegisterDevice: ctx.isRegisterDevice === true,
  };
}
