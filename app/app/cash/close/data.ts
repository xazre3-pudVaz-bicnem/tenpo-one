/**
 * 入出金（/app/cash）とレジクローズ（/app/cash/close）で共有する読み取り処理。
 * 取得はすべてセッションの supabase クライアント（RLS適用）で行う。締め処理そのものは
 * app/app/cash/actions.ts の既存サーバーアクションだけを使う（ここでは書き込まない）。
 */
import { createClient } from '@/lib/supabase/server';
import { expectedCash } from '@/lib/metrics';
import type { ChecklistItem } from '@/components/cash/checklist-card';
import type { RegisterBreakdownRow } from '@/components/cash/closing-snapshot';
import { PETTY_KINDS, type CashKind } from '@/components/cash/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 店舗日次締め（close_store_day）を実行できるロール。app/app/cash/actions.tsのSTORE_DAY_CLOSE_ROLESと一致させること */
export const STORE_DAY_CLOSE_ROLES = ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'];
/** 店舗日次締めの再オープン（reopen_store_day）を実行できるロール */
export const STORE_DAY_REOPEN_ROLES = ['org_owner', 'hq_admin', 'area_manager'];

/** 予約が「本日まだ有効」とみなせるステータス（仮予約・キャンセル・無断キャンセル・会計済み・キャンセル待ちは除く） */
const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'waiting', 'arrived', 'seated', 'billing'];

/** 出金レシートの確認対象になる kind（レジの出金・小口出金・立替） */
export const RECEIPT_CHECK_KINDS: CashKind[] = ['withdrawal', 'petty_out', 'petty_advance'];

/** register_breakdown（jsonb）の1要素の生の型。supabase/migrations/00027の close_store_day が生成する */
export interface RawRegisterBreakdownEntry {
  register_id: string;
  register_name: string;
  session_id: string;
  opening_float: number;
  cash_sales: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash: number;
  difference: number;
  closed_by: string | null;
}

export function mapRegisterBreakdown(raw: unknown, nameById: Map<string, string>): RegisterBreakdownRow[] {
  return ((raw as RawRegisterBreakdownEntry[] | null) ?? []).map((e) => ({
    registerName: e.register_name,
    openingFloat: e.opening_float,
    cashSales: e.cash_sales,
    cashRefunds: e.cash_refunds,
    cashIn: e.cash_in,
    cashOut: e.cash_out,
    expectedCash: e.expected_cash,
    countedCash: e.counted_cash,
    difference: e.difference,
    closedByName: e.closed_by ? (nameById.get(e.closed_by) ?? '—') : '—',
  }));
}

export interface OpenSessionState {
  id: string;
  registerId: string;
  registerName: string;
  /** このセッションの営業日。当日でなければ「前営業日から開きっぱなし」 */
  businessDate: string;
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  breakdown: Partial<Record<CashKind, number>>;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  theoreticalCash: number;
}

export interface ClosedSessionState {
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
}

export type RegisterCardState =
  | { type: 'unopened'; registerId: string; registerName: string }
  | { type: 'open'; session: OpenSessionState }
  | { type: 'closed'; session: ClosedSessionState };

/** レジ台（開局・中間入出金・レジ締め）と店舗日次締めの状態をまとめて読む */
export async function loadRegisterBoard(storeId: string, today: string) {
  const supabase = await createClient();

  const [
    { data: registers },
    { data: todaySessions },
    { data: todayClosing },
    { count: unpaidOrdersCount },
    { data: unservedKdsRows },
    { count: unclockedStaffCount },
    { count: pendingPettyCount },
    { count: reservationsCount },
    { count: shiftsCount },
    { data: lowStockRows },
    { count: openTasksCount },
    { count: printerCount },
  ] = await Promise.all([
    supabase.from('registers').select('id, name').eq('store_id', storeId).eq('status', 'active').order('name'),
    // 当日分に加えて、別の営業日から開きっぱなしのセッションも拾う。
    // 当日分だけを見ると、前営業日から開いたままのレジが画面上「未開局」に見えるのに
    // open_register_session は SESSION_ALREADY_OPEN で拒否する（＝開局も締めもできない）状態になる。
    supabase
      .from('register_sessions')
      .select(
        'id, register_id, business_date, status, opened_at, opened_by, opening_float, closed_at, closed_by, counted_cash, expected_cash, difference, registers(name)'
      )
      .eq('store_id', storeId)
      .or(`business_date.eq.${today},status.eq.open`)
      .order('opened_at'),
    supabase.from('daily_closings').select('*').eq('store_id', storeId).eq('business_date', today).maybeSingle(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('business_date', today)
      .eq('status', 'open'),
    supabase
      .from('order_items')
      .select('id, orders!inner(status, business_date)')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .neq('kitchen_status', 'served')
      .eq('orders.status', 'open')
      .eq('orders.business_date', today),
    supabase
      .from('time_entries')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('work_date', today)
      .not('clock_in_at', 'is', null)
      .is('clock_out_at', null),
    supabase
      .from('cash_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .in('kind', PETTY_KINDS)
      .eq('approval_status', 'pending'),
    supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('reserved_date', today)
      .in('status', ACTIVE_RESERVATION_STATUSES),
    supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('shift_date', today)
      .neq('status', 'cancelled'),
    supabase
      .from('inventory_items')
      .select('id, current_quantity, reorder_point')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .not('reorder_point', 'is', null),
    supabase
      .from('store_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .in('status', ['open', 'in_progress']),
    supabase.from('printer_configs').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
  ]);

  // 開局・締め担当者名の解決（今日のセッションに登場する opened_by / closed_by のみ）
  const profileIds = [
    ...new Set((todaySessions ?? []).flatMap((s) => [s.opened_by, s.closed_by]).filter((v): v is string => !!v)),
  ];
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', profileIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  // todaySessions は「当日分 ∪ 開局中（営業日問わず）」
  const openSessionRows = (todaySessions ?? []).filter((s) => s.status === 'open');
  const sessionIds = openSessionRows.map((s) => s.id);
  const { data: sessionTx } = sessionIds.length
    ? await supabase
        .from('cash_transactions')
        .select('register_session_id, kind, amount')
        .in('register_session_id', sessionIds)
        .eq('status', 'active')
    : { data: [] as { register_session_id: string | null; kind: string; amount: number }[] };

  const breakdownBySession = new Map<string, Partial<Record<CashKind, number>>>();
  for (const t of sessionTx ?? []) {
    if (!t.register_session_id) continue;
    const bucket = breakdownBySession.get(t.register_session_id) ?? {};
    const k = t.kind as CashKind;
    bucket[k] = (bucket[k] ?? 0) + t.amount;
    breakdownBySession.set(t.register_session_id, bucket);
  }

  // レジごとの「本日の最新セッション」（開局中があればそれを優先。無ければ最後に締めたもの）
  type TodaySession = NonNullable<typeof todaySessions>[number];
  const sessionsByRegister = new Map<string, TodaySession[]>();
  for (const s of todaySessions ?? []) {
    const arr = sessionsByRegister.get(s.register_id) ?? [];
    arr.push(s);
    sessionsByRegister.set(s.register_id, arr);
  }
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? '—') : '—');

  const openSessions: OpenSessionState[] = [];
  const cards: RegisterCardState[] = (registers ?? []).map((r) => {
    const arr = sessionsByRegister.get(r.id) ?? [];
      // 開局中セッションは営業日を問わず最優先（前営業日から開きっぱなしのレジをここで締められるようにする）。
    // 締め済みカードは当日分だけを見る（別日の締め済みセッションは今日の画面に出さない）。
    const todayArr = arr.filter((s) => s.business_date === today);
    const session =
      arr.find((s) => s.status === 'open') ?? (todayArr.length === 0 ? null : todayArr[todayArr.length - 1]);
    if (!session) return { type: 'unopened', registerId: r.id, registerName: r.name };
    const registerName = (session.registers as unknown as { name: string } | null)?.name ?? r.name;
    if (session.status === 'open') {
      const breakdown = breakdownBySession.get(session.id) ?? {};
      const cashSales = breakdown.sale ?? 0;
      const cashRefunds = breakdown.refund ?? 0;
      const cashIn = (breakdown.deposit ?? 0) + (breakdown.petty_in ?? 0);
      const cashOut = (breakdown.withdrawal ?? 0) + (breakdown.petty_out ?? 0);
      const state: OpenSessionState = {
        id: session.id,
        registerId: r.id,
        registerName,
        businessDate: session.business_date,
        openedAt: session.opened_at,
        openedByName: nameOf(session.opened_by),
        openingFloat: session.opening_float,
        breakdown,
        cashSales,
        cashRefunds,
        cashIn,
        cashOut,
        theoreticalCash: expectedCash({ openingFloat: session.opening_float, cashSales, cashIn, cashRefunds, cashOut }),
      };
      openSessions.push(state);
      return { type: 'open', session: state };
    }
    return {
      type: 'closed',
      session: {
        id: session.id,
        registerName,
        openedByName: nameOf(session.opened_by),
        closedByName: nameOf(session.closed_by),
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        openingFloat: session.opening_float,
        expectedCash: session.expected_cash,
        countedCash: session.counted_cash,
        difference: session.difference,
      },
    };
  });

  const unservedKdsCount = (unservedKdsRows ?? []).length;
  const lowStockCount = (lowStockRows ?? []).filter(
    (i) => i.reorder_point != null && Number(i.current_quantity) <= Number(i.reorder_point)
  ).length;
  const openRegistersCount = openSessions.length;
  /** 別の営業日から開きっぱなしのレジ（今日の画面では「未開局」に見えてしまっていたもの） */
  const staleOpenCount = openSessions.filter((s) => s.businessDate !== today).length;
  const closedTodayCount = cards.filter((c) => c.type === 'closed').length;
  const totalRegistersCount = (registers ?? []).length;

  // ---- 開店チェックリスト ----
  const openingItems: ChecklistItem[] = [
    {
      key: 'registers-open',
      label: 'レジ開局状態',
      valueLabel: totalRegistersCount === 0 ? '未登録' : `${openRegistersCount}/${totalRegistersCount}台 開局中`,
      status: totalRegistersCount > 0 && openRegistersCount === totalRegistersCount ? 'ok' : 'warn',
    },
    { key: 'reservations', label: '本日の予約組数', valueLabel: `${reservationsCount ?? 0}組`, status: 'info', href: '/app/reservations' },
    { key: 'shifts', label: '本日の出勤予定', valueLabel: `${shiftsCount ?? 0}名`, status: 'info', href: '/app/shifts' },
    {
      key: 'inventory',
      label: '発注点割れの重要在庫',
      valueLabel: `${lowStockCount}品`,
      status: lowStockCount === 0 ? 'ok' : 'warn',
      href: '/app/inventory?sort=warning',
    },
    {
      key: 'tasks',
      label: '未完了タスク',
      valueLabel: `${openTasksCount ?? 0}件`,
      status: (openTasksCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/tasks',
    },
    {
      key: 'printer',
      label: 'レシートプリンター',
      valueLabel: (printerCount ?? 0) > 0 ? `${printerCount}台登録（Simulation）` : '未登録（Simulation）',
      status: 'info',
      href: '/app/settings/printers',
    },
  ];

  // ---- 店舗日次締め 実行前チェック ----
  const preCloseItems: ChecklistItem[] = [
    {
      key: 'unpaid-orders',
      label: '未会計伝票（当営業日）',
      valueLabel: `${unpaidOrdersCount ?? 0}件`,
      status: (unpaidOrdersCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/orders?status=open',
    },
    {
      key: 'unserved-kds',
      label: '未提供KDS',
      valueLabel: `${unservedKdsCount}件`,
      status: unservedKdsCount === 0 ? 'ok' : 'warn',
      href: '/app/kitchen',
    },
    {
      key: 'unclocked-staff',
      label: '未退勤スタッフ',
      valueLabel: `${unclockedStaffCount ?? 0}名`,
      status: (unclockedStaffCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/attendance',
    },
    {
      key: 'open-registers',
      label: '未締めレジ',
      valueLabel:
        staleOpenCount > 0
          ? `${openRegistersCount}台（うち前営業日から${staleOpenCount}台）`
          : `${openRegistersCount}台`,
      status: openRegistersCount === 0 ? 'ok' : 'warn',
    },
    {
      // 「レジを1台も開けずに1日を終えた」場合、店舗日次締めは NO_CLOSED_SESSIONS で必ず失敗する。
      // 押してから怒られるのではなく、押す前に気づけるようにしておく。
      key: 'closed-registers',
      label: '本日締めたレジ',
      valueLabel: `${closedTodayCount}台`,
      status: closedTodayCount > 0 ? 'ok' : 'warn',
    },
    {
      key: 'pending-petty',
      label: '承認待ち小口現金',
      valueLabel: `${pendingPettyCount ?? 0}件`,
      status: (pendingPettyCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/cash?tab=petty',
    },
  ];

  return {
    cards,
    openSessions,
    staleOpenCount,
    closedTodayCount,
    totalRegistersCount,
    todayClosing,
    registerBreakdown: mapRegisterBreakdown(todayClosing?.register_breakdown, nameById),
    openingItems,
    preCloseItems,
  };
}

export interface TodayCashRow {
  id: string;
  kind: CashKind;
  amount: number;
  purpose: string | null;
  occurredAt: string;
  approvalStatus: string;
  receiptDocumentId: string | null;
  createdByName: string;
  registerName: string | null;
  /** 立替（petty_advance）のみ: 精算が済んでいないか（FIFO消込の概算） */
  advanceOpen: boolean;
}

/**
 * 本日の入出金（売上・返金以外）。立替は承認済み精算を古い立替から順に充当（FIFO）して未精算を判定する。
 * 小口現金画面の「立替残高（概算）」と同じ前提で、個別の消込は持たない。
 */
export async function loadTodayCashRows(storeId: string, today: string): Promise<TodayCashRow[]> {
  const supabase: Supabase = await createClient();
  const [{ data: rows }, { data: advanceLedger }] = await Promise.all([
    supabase
      .from('cash_transactions')
      .select('id, kind, amount, purpose, occurred_at, approval_status, receipt_document_id, created_by, register_sessions(registers(name))')
      .eq('store_id', storeId)
      .eq('business_date', today)
      .eq('status', 'active')
      .in('kind', ['deposit', 'withdrawal', 'petty_in', 'petty_out', 'petty_advance', 'petty_settlement', 'adjustment'])
      .neq('approval_status', 'rejected')
      .order('occurred_at', { ascending: false })
      .limit(200),
    supabase
      .from('cash_transactions')
      .select('id, kind, amount, occurred_at')
      .eq('store_id', storeId)
      .in('kind', ['petty_advance', 'petty_settlement'])
      .eq('approval_status', 'approved')
      .eq('status', 'active')
      .order('occurred_at', { ascending: true })
      .limit(2000),
  ]);

  // FIFO: 精算総額を古い立替から順に充当し、残りがある立替を未精算とする
  let settlementPool = (advanceLedger ?? []).filter((t) => t.kind === 'petty_settlement').reduce((a, t) => a + t.amount, 0);
  const settledAdvanceIds = new Set<string>();
  for (const t of (advanceLedger ?? []).filter((x) => x.kind === 'petty_advance')) {
    if (settlementPool >= t.amount) {
      settlementPool -= t.amount;
      settledAdvanceIds.add(t.id);
    } else {
      settlementPool = 0;
    }
  }

  const creatorIds = [...new Set((rows ?? []).map((r) => r.created_by).filter((v): v is string => !!v))];
  const { data: profiles } = creatorIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', creatorIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  return (rows ?? []).map((r) => {
    const session = r.register_sessions as unknown as { registers: { name: string } | null } | null;
    return {
      id: r.id,
      kind: r.kind as CashKind,
      amount: r.amount,
      purpose: r.purpose,
      occurredAt: r.occurred_at,
      approvalStatus: r.approval_status,
      receiptDocumentId: r.receipt_document_id,
      createdByName: r.created_by ? (nameById.get(r.created_by) ?? '—') : '—',
      registerName: session?.registers?.name ?? null,
      advanceOpen: r.kind === 'petty_advance' && !settledAdvanceIds.has(r.id),
    };
  });
}

/** 出金レシートの状態。ok=レシートあり/精算済、scan=未スキャン、advance=仮払い未精算 */
export function receiptStateOf(row: Pick<TodayCashRow, 'kind' | 'receiptDocumentId' | 'advanceOpen'>): 'ok' | 'scan' | 'advance' | 'none' {
  if (!RECEIPT_CHECK_KINDS.includes(row.kind)) return 'none';
  if (row.kind === 'petty_advance') return row.advanceOpen ? 'advance' : 'ok';
  return row.receiptDocumentId ? 'ok' : 'scan';
}
