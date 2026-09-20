import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { METHOD_LABELS } from '@/components/cash/labels';
import { formatDateTime, weekdayJa } from '@/lib/format';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';
import { kitchenTicketEpos, eposCols } from '@/lib/epos-print';
import { STAR_WIDTH_OPTIONS } from '@/lib/receipt-layout';
import { isCheckViolation, isMissingColumnError } from '@/lib/schema-compat';
import {
  layoutRegisterReport,
  parseDenominations,
  taxByRateFor,
  type RegisterReportData,
  type ReportChannel,
  type ReportCountAmount,
} from '@/lib/register-report';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** レジ精算レシートのジョブに載せる既定の形式（app/app/pos/print-actions.ts と同じ） */
const RECEIPT_CONTENT_TYPE = 'text/vnd.star.markup';

const ITEM_TYPE_LABELS: Record<string, string> = {
  food: 'フード',
  drink: 'ドリンク',
  course: 'コース',
  option: 'オプション',
};
const ITEM_TYPE_ORDER = ['food', 'drink', 'course', 'option', 'other'];

/** 予約経路が無いときの媒体名（dinii と同じ「フリー」）。created_via はコード値なので日本語にする */
const CREATED_VIA_LABELS: Record<string, string> = {
  walk_in: 'フリー',
  phone: '電話予約',
  web: 'WEB予約',
  manual: '手入力予約',
};

const jstNowLabel = () => formatDateTime(new Date());

/** 'YYYY-MM-DD' → '2026/09/20（日）' */
function businessDateLabel(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${y}/${m}/${d}（${weekdayJa(date)}）`;
}

/**
 * レジセッションIDからレジ精算レシートのデータを組み立てる。
 * 売上系はそのセッションの営業日の店舗全体（複数レジでも1枚で店の1日が分かる）、
 * 精算情報（釣銭準備金・実査・差額・金種）はそのセッションのもの。
 * 渡されたクライアントの権限で読む（セッション=RLS）。見つからなければ null。
 */
export async function loadRegisterReportData(
  supabase: AnyClient,
  sessionId: string
): Promise<{ data: RegisterReportData; storeId: string; organizationId: string } | null> {
  const SESSION_COLUMNS =
    'id, organization_id, store_id, register_id, business_date, status, opened_at, opened_by, closed_at, closed_by, opening_float, expected_cash, counted_cash, difference, difference_reason, note, registers(name), stores(name)';
  let sessionRes = await supabase
    .from('register_sessions')
    .select(`${SESSION_COLUMNS}, counted_denominations`)
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionRes.error && isMissingColumnError(sessionRes.error.message, 'counted_denominations')) {
    // migration 00062 未適用（金種列が無い）。金種表なしで精算レシートを出す
    sessionRes = await supabase.from('register_sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
  }
  const session = sessionRes.data as
    | (Record<string, unknown> & { counted_denominations?: unknown })
    | null;
  if (!session) return null;

  const storeId = session.store_id as string;
  const bd = session.business_date as string;

  const [
    { data: orders },
    { data: cancelledOrders },
    { data: payments },
    { data: refunds },
    { data: items },
    { data: cancelledItems },
    { data: sessionTx },
    { data: ryoshushoJobs },
    { data: otherOpen },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total, discount_total, service_charge, tax_total, guest_count, status, reservation_id')
      .eq('store_id', storeId)
      .eq('business_date', bd)
      .in('status', ['paid', 'refunded'])
      .limit(5000),
    supabase
      .from('orders')
      .select('id, total')
      .eq('store_id', storeId)
      .eq('business_date', bd)
      .eq('status', 'cancelled')
      .limit(5000),
    supabase
      .from('payments')
      .select('method, amount')
      .eq('store_id', storeId)
      .eq('business_date', bd)
      .eq('status', 'completed')
      .limit(10000),
    supabase.from('refunds').select('amount, kind, method').eq('store_id', storeId).eq('business_date', bd).limit(5000),
    supabase
      .from('order_items')
      .select('quantity, line_total, tax_rate, menu_items(item_type), orders!inner(status, business_date)')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .eq('orders.business_date', bd)
      .in('orders.status', ['paid', 'refunded'])
      .limit(20000),
    supabase
      .from('order_items')
      .select('line_total, orders!inner(business_date)')
      .eq('store_id', storeId)
      .eq('status', 'cancelled')
      .eq('orders.business_date', bd)
      .limit(5000),
    supabase
      .from('cash_transactions')
      .select('kind, amount, purpose')
      .eq('register_session_id', sessionId)
      .eq('status', 'active')
      .order('occurred_at'),
    supabase
      .from('print_jobs')
      .select('order_id, orders!inner(business_date, total)')
      .eq('store_id', storeId)
      .eq('job_type', 'ryoshusho')
      .eq('orders.business_date', bd)
      .limit(2000),
    supabase
      .from('register_sessions')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'open')
      .neq('id', sessionId)
      .limit(5),
  ]);

  // 担当者名
  const profileIds = [session.opened_by, session.closed_by].filter((v): v is string => !!v);
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', profileIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameOf = (id: string | null) =>
    id ? ((profiles ?? []).find((p) => p.id === id)?.display_name ?? '—') : '—';

  // 媒体別（予約経路）。予約に紐付かない注文は「フリー」
  const reservationIds = [...new Set((orders ?? []).map((o) => o.reservation_id).filter((v): v is string => !!v))];
  const { data: reservations } = reservationIds.length
    ? await supabase
        .from('reservations')
        .select('id, created_via, reservation_sources(name)')
        .in('id', reservationIds)
    : { data: [] as { id: string; created_via: string; reservation_sources: unknown }[] };
  const channelOfReservation = new Map<string, string>();
  for (const r of reservations ?? []) {
    const source = r.reservation_sources as unknown as { name: string } | null;
    channelOfReservation.set(r.id, source?.name ?? CREATED_VIA_LABELS[r.created_via] ?? r.created_via);
  }

  // ---- 売上 ----
  const settled = orders ?? [];
  const gross = settled.reduce((a, o) => a + o.total, 0);
  const discount = settled.reduce((a, o) => a + o.discount_total, 0);
  const serviceCharge = settled.reduce((a, o) => a + o.service_charge, 0);
  const taxTotal = settled.reduce((a, o) => a + o.tax_total, 0);
  const net = gross - taxTotal;
  const grossBeforeDiscount = gross + discount;
  const netBeforeDiscount = gross > 0 ? Math.round((net * grossBeforeDiscount) / gross) : 0;
  const refundTotal = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const guests = settled.reduce((a, o) => a + (o.guest_count ?? 0), 0);

  const taxByRate = taxByRateFor(
    (items ?? []).map((it) => ({ lineTotal: it.line_total as number, taxRate: Number(it.tax_rate) })),
    gross
  );

  // ---- 支払方法別 ----
  const groupByMethod = (rows: { method: string; amount: number }[]): ReportCountAmount[] => {
    const m = new Map<string, ReportCountAmount>();
    for (const r of rows) {
      const cur = m.get(r.method) ?? { label: METHOD_LABELS[r.method] ?? r.method, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += r.amount;
      m.set(r.method, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const paymentsByMethod = groupByMethod(payments ?? []);
  const refundsByMethod = groupByMethod(refunds ?? []);

  // ---- メニュータイプ別 ----
  const byType = new Map<string, { quantity: number; amount: number }>();
  for (const it of items ?? []) {
    const type = (it.menu_items as unknown as { item_type: string } | null)?.item_type ?? 'other';
    const cur = byType.get(type) ?? { quantity: 0, amount: 0 };
    cur.quantity += it.quantity as number;
    cur.amount += it.line_total as number;
    byType.set(type, cur);
  }
  const byItemType = ITEM_TYPE_ORDER.filter((t) => byType.has(t) || t !== 'other').map((t) => ({
    label: ITEM_TYPE_LABELS[t] ?? 'その他',
    quantity: byType.get(t)?.quantity ?? 0,
    amount: byType.get(t)?.amount ?? 0,
  }));

  // ---- 媒体別 ----
  const channels = new Map<string, ReportChannel>();
  for (const o of settled) {
    const label = (o.reservation_id && channelOfReservation.get(o.reservation_id)) || 'フリー';
    const cur = channels.get(label) ?? { label, sales: 0, guests: 0, groups: 0 };
    cur.sales += o.total;
    cur.guests += o.guest_count ?? 0;
    cur.groups += 1;
    channels.set(label, cur);
  }
  const byChannel: ReportChannel[] = [
    { label: '全体', sales: gross, guests, groups: settled.length },
    ...[...channels.values()].sort((a, b) => b.sales - a.sales),
  ];

  // ---- 精算情報（このセッション） ----
  const sum = (kinds: string[]) =>
    (sessionTx ?? []).filter((t) => kinds.includes(t.kind)).reduce((a, t) => a + t.amount, 0);
  const cashSales = sum(['sale']);
  const cashRefunds = sum(['refund']);
  const cashIn = sum(['deposit', 'petty_in']);
  const cashOut = sum(['withdrawal', 'petty_out']);
  const openingFloat = session.opening_float as number;
  const expected = (session.expected_cash as number | null) ?? openingFloat + cashSales - cashRefunds + cashIn - cashOut;
  const purposeOf = (t: { purpose: string | null; kind: string }) =>
    t.purpose?.trim() || (t.kind === 'deposit' || t.kind === 'petty_in' ? '入金' : '出金');
  const cashIns = (sessionTx ?? [])
    .filter((t) => t.kind === 'deposit' || t.kind === 'petty_in')
    .map((t) => ({ purpose: purposeOf(t), amount: t.amount }));
  const cashOuts = (sessionTx ?? [])
    .filter((t) => t.kind === 'withdrawal' || t.kind === 'petty_out')
    .map((t) => ({ purpose: purposeOf(t), amount: t.amount }));

  // ---- 業務履歴 ----
  const voids = (refunds ?? []).filter((r) => r.kind === 'void');
  const plainRefunds = (refunds ?? []).filter((r) => r.kind !== 'void');
  const ryoshushoOrders = new Map<string, number>();
  for (const j of ryoshushoJobs ?? []) {
    if (!j.order_id) continue;
    ryoshushoOrders.set(j.order_id, (j.orders as unknown as { total: number } | null)?.total ?? 0);
  }
  const activity: ReportCountAmount[] = [
    { label: 'レジ会計', count: settled.length, amount: gross },
    {
      label: '領収書発行',
      count: ryoshushoOrders.size,
      amount: [...ryoshushoOrders.values()].reduce((a, v) => a + v, 0),
    },
    { label: '取消（VOID）', count: voids.length, amount: -voids.reduce((a, r) => a + r.amount, 0) },
    { label: '返金', count: plainRefunds.length, amount: -plainRefunds.reduce((a, r) => a + r.amount, 0) },
    {
      label: 'メニュー注文減数',
      count: (cancelledItems ?? []).length,
      amount: -(cancelledItems ?? []).reduce((a, it) => a + (it.line_total as number), 0),
    },
    {
      label: '注文キャンセル',
      count: (cancelledOrders ?? []).length,
      amount: -(cancelledOrders ?? []).reduce((a, o) => a + o.total, 0),
    },
  ];

  const notes: string[] = [];
  if (session.difference_reason) notes.push(`差額理由: ${session.difference_reason}`);
  if (session.note) notes.push(session.note as string);
  if ((otherOpen ?? []).length > 0) notes.push('他のレジが開局中のため、売上情報は締め時点までの店舗全体の集計です');

  const data: RegisterReportData = {
    storeName: (session.stores as unknown as { name: string } | null)?.name ?? '',
    registerName: (session.registers as unknown as { name: string } | null)?.name ?? '',
    businessDateLabel: businessDateLabel(bd),
    sessionNo: String(session.id).slice(0, 8).toUpperCase(),
    openedAtLabel: formatDateTime(session.opened_at as string),
    openedBy: nameOf(session.opened_by as string | null),
    closedAtLabel: session.closed_at ? formatDateTime(session.closed_at as string) : '—（開局中）',
    closedBy: nameOf(session.closed_by as string | null),
    printedAtLabel: jstNowLabel(),
    sales: {
      gross,
      net,
      grossBeforeDiscount,
      netBeforeDiscount,
      discount,
      serviceCharge,
      refunds: refundTotal,
      ordersCount: settled.length,
      guests,
      taxByRate,
    },
    payments: paymentsByMethod,
    refundsByMethod,
    discounts: { count: settled.filter((o) => o.discount_total > 0).length, amount: discount },
    surcharges: { count: settled.filter((o) => o.service_charge > 0).length, amount: serviceCharge },
    byItemType,
    byChannel,
    cash: {
      openingFloat,
      cashSales,
      cashRefunds,
      cashIn,
      cashOut,
      expected,
      counted: session.counted_cash as number | null,
      difference: session.difference as number | null,
      denominations: parseDenominations(session.counted_denominations),
    },
    cashIns,
    cashOuts,
    activity,
    note: notes.length ? notes.join(' / ') : null,
  };

  return { data, storeId, organizationId: session.organization_id as string };
}

export interface RegisterReportPrintResult {
  ok: boolean;
  error?: string;
}

/**
 * レジ精算レシートを店舗のレシートプリンター（usage='receipt'・CloudPRNT/Server Direct Print 有効）へ積む。
 * プリンター未設定・データ取得失敗は ok:false で返す（呼び出し側で「締めは完了、印刷だけ失敗」と扱えるように）。
 */
export async function enqueueRegisterReportPrint(
  supabase: AnyClient,
  sessionId: string,
  userId: string
): Promise<RegisterReportPrintResult> {
  const loaded = await loadRegisterReportData(supabase, sessionId);
  if (!loaded) return { ok: false, error: '対象のレジセッションが見つかりません' };

  const { data: printer } = await supabase
    .from('printer_configs')
    .select('id, paper_width_mm')
    .eq('store_id', loaded.storeId)
    .eq('status', 'active')
    .eq('cloudprnt_enabled', true)
    .eq('usage', 'receipt')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!printer) return { ok: false, error: 'レシートプリンターが未設定のため、レジ精算レシートを印刷できません' };

  const paper = printer.paper_width_mm === 58 ? 58 : 80;
  const lines = layoutRegisterReport(loaded.data, { paperWidth: paper, ...STAR_WIDTH_OPTIONS });
  // EPSON機は1行の桁数が少なく「¥」が全角幅のため、専用の桁数で組み直す（厨房伝票と同じ扱い）
  const eposLines = layoutRegisterReport(loaded.data, { columns: eposCols(paper), yenFullWidth: true });
  const job = (jobType: 'register_report' | 'receipt') => ({
    organization_id: loaded.organizationId,
    store_id: loaded.storeId,
    printer_config_id: printer.id,
    job_type: jobType,
    target: 'cloudprnt',
    content_type: RECEIPT_CONTENT_TYPE,
    payload: {
      body: kitchenTicketMarkup(lines),
      starprnt: kitchenTicketStarPrnt(lines).toString('base64'),
      epos: kitchenTicketEpos(eposLines),
      kind: 'register_report',
      register_session_id: sessionId,
    },
    status: 'queued',
    created_by: userId,
  });
  let { error } = await supabase.from('print_jobs').insert(job('register_report'));
  if (error && isCheckViolation(error.message, 'print_jobs_job_type_check')) {
    // migration 00062 未適用（job_type に register_report が無い）。receipt として積んでも印字経路は同じ
    ({ error } = await supabase.from('print_jobs').insert(job('receipt')));
  }
  if (error) return { ok: false, error: `印刷ジョブの登録に失敗しました: ${error.message}` };
  return { ok: true };
}
