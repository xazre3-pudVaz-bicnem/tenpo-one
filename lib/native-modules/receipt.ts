import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { buildReceipt, type ReceiptData } from '@/lib/receipts';
import { billSlipLines, formatReceiptAddress } from '@/lib/receipt-layout';
import { classicInvoiceLayout } from '@/lib/classic-invoice';
import { METHOD_LABELS } from '@/components/cash/labels';
import {
  RYOSHUSHO_DEFAULT_PURPOSE,
  RYOSHUSHO_INVOICE_NOTE,
  RYOSHUSHO_ISSUED_MESSAGE,
  RYOSHUSHO_NO_STAMP_NOTE,
  jstShortDateTime,
  ryoshushoIssuedFrom,
  type RyoshushoIssueState,
  type RyoshushoJobRow,
} from '@/lib/ryoshusho-issue';
import type { NativeModuleGet } from '@/lib/native-modules/registry';

/**
 * レシートのプレビュー（ネイティブ）。GET ?part=receipt&id=<伝票>&reissue=1
 * 2026-10-25 12:49 Ronnie「レシートのプレビュー Native banau」。
 *
 * 中身は Web の /app/pos/receipt/[orderId]（app/app/pos/receipt/[orderId]/page.tsx）と同じ：
 *   読む列・入口の確かめ（伝票が無い／ほかの店の伝票は本部以外 404）・buildReceipt（lib/receipts.ts）・
 *   画面に出す明細（billSlipLines＝取消と0円を落として同じものをまとめる）・領収書の発行済み（print_jobs）。
 * 領収書の見た目は印字と同じ座標（lib/classic-invoice.ts の classicInvoiceLayout）をそのまま渡す（iPad／iPhone はそれを描くだけ）。
 * 印刷は今までの POST（slipReceipt ／ slipRyoshusho。伝票明細と同じ）を使う。ここは読むだけ。
 * 印字・レシートの組み立ては別のチームの持ち物なので、呼ぶだけで中は変えない。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 円（DB の numeric が文字で来ても整数にそろえる） */
const yenInt = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const yenOrNull = (v: unknown): number | null => (v == null ? null : yenInt(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface NativeReceiptQuery {
  id: string;
  reissue: boolean;
}

/** ?id=<伝票>&reissue=1（Web の ?reissue=1 と同じ。領収書には効かない） */
export function parseNativeReceiptQuery(q: URLSearchParams): NativeReceiptQuery | null {
  const id = q.get('id') ?? '';
  if (!UUID.test(id)) return null;
  return { id, reissue: q.get('reissue') === '1' };
}

/** 印字と同じ座標の領収書（iPad／iPhone はこの通りに描く）。Swift で読みやすいように形をそろえる */
export function nativeInvoiceLayout(receipt: ReceiptData, amount: number, tax: number) {
  const layout = classicInvoiceLayout(receipt, { recipientName: '', purpose: RYOSHUSHO_DEFAULT_PURPOSE, amount, tax, label: '' });
  return {
    width: layout.width,
    height: layout.height,
    items: layout.items.map((it) =>
      it.kind === 'text'
        ? { kind: 'text', x: it.x, y: it.y, w: it.width, h: 0, text: it.text, size: it.size, bold: !!it.bold, align: it.align ?? 'left' }
        : it.kind === 'line'
          ? { kind: 'line', x: it.x, y: it.y, w: it.width, h: 0, text: '', size: 0, bold: false, align: 'left' }
          : { kind: 'box', x: it.x, y: it.y, w: it.width, h: it.height, text: '', size: 0, bold: false, align: 'left' }
    ),
  };
}

export interface NativeReceiptBodyInput {
  orderId: string;
  status: string;
  hasVoid: boolean;
  receipt: ReceiptData;
  ryoshusho: RyoshushoIssueState;
  /** CloudPRNT のレシートプリンターがある（Web の「プリンタで印刷」と同じ判定） */
  printerReady: boolean;
}

/** iPad／iPhone に返す中身（純粋な関数。テスト対象） */
export function buildNativeReceiptBody(input: NativeReceiptBodyInput) {
  const r = input.receipt;
  // 取消済みと0円の明細（飲み放題・コースの中身）は出さない。同じものは1行にまとめる（Web の ReceiptView・印字と同じ）
  const lines = billSlipLines(r.lines.filter((l) => !l.cancelled)).map((l) => ({
    name: l.name,
    quantity: num(l.quantity),
    unitPrice: yenInt(l.unitPrice),
    lineTotal: yenInt(l.lineTotal),
    modifiers: (l.modifiers ?? []).map((m) => ({ name: String(m.name ?? ''), price: yenInt(m.price) })),
  }));
  const taxRows = r.taxRows.map((t) => ({ rate: num(t.rate), taxable: yenInt(t.taxable), tax: yenInt(t.tax) }));
  const invoiceTax = taxRows.reduce((a, t) => a + t.tax, 0);
  const netPaid = yenInt(r.netPaid);
  const iss = input.ryoshusho;
  return {
    ok: true,
    orderId: input.orderId,
    orderNo: r.orderNo,
    status: input.status,
    storeName: r.storeName,
    // レシートの再印刷は会計が済んだ伝票だけ（iPhone の伝票明細と同じ）
    canPrint: input.status !== 'open',
    // 領収書は会計済み・取消（VOID）なしの伝票だけ（Web の伝票明細の「領収書」と同じ）
    canRyoshusho: input.status === 'paid' && !input.hasVoid,
    printerReady: input.printerReady,
    receipt: {
      isReissue: r.isReissue,
      storeName: r.storeName,
      storeAddress: r.storeAddress ? formatReceiptAddress(r.storeAddress) : null,
      storePhone: r.storePhone,
      registrationNumber: r.registrationNumber,
      headerMessage: r.headerMessage,
      footerMessage: r.footerMessage,
      registerName: r.registerName,
      tableName: r.tableName,
      staffName: r.staffName,
      guestCount: r.guestCount ?? null,
      orderNo: r.orderNo,
      issuedAt: r.issuedAt,
      startedAt: r.startedAt ?? null,
      // Web と同じ：会計日時は会計済みのときだけ（buildReceipt は未会計なら null）
      completedAt: r.completedAt === undefined ? r.issuedAt : r.completedAt,
      lines,
      subtotal: yenInt(r.subtotal),
      taxRows,
      serviceCharge: yenInt(r.serviceCharge),
      discount: yenInt(r.discount),
      couponCode: r.couponCode,
      total: yenInt(r.total),
      payments: r.payments.map((p) => ({ label: p.label, amount: yenInt(p.amount) })),
      tendered: yenOrNull(r.tendered),
      change: yenOrNull(r.change),
      refundTotal: yenInt(r.refundTotal),
      netPaid,
      pointsEarned: yenOrNull(r.pointsEarned),
      pointsUsed: yenOrNull(r.pointsUsed),
      pointBalance: yenOrNull(r.pointBalance),
      qrContent: r.qrContent,
    },
    invoice: {
      amount: netPaid,
      tax: invoiceTax,
      purpose: RYOSHUSHO_DEFAULT_PURPOSE,
      invoiceNote: r.registrationNumber ? RYOSHUSHO_INVOICE_NOTE : null,
      noStampNote: RYOSHUSHO_NO_STAMP_NOTE,
      layout: nativeInvoiceLayout(r, netPaid, invoiceTax),
    },
    ryoshusho: {
      issued: iss.issued,
      at: iss.at,
      atLabel: jstShortDateTime(iss.at),
      count: iss.count,
      message: RYOSHUSHO_ISSUED_MESSAGE,
    },
  };
}

const NOT_FOUND = { status: 404, body: { ok: false, error: 'レシートが見つかりません。この注文は存在しないか、アクセスできません' } };

/** GET ?part=receipt&id=<伝票>&reissue=1 */
export const receiptGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const q = parseNativeReceiptQuery(url.searchParams);
  if (!q) return { status: 400, body: { ok: false, error: '伝票が正しくありません' } };
  const supabase = await createClient();

  // Web のページと同じ列（＋ status：会計済みか・領収書を出せるか）
  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, status, guest_count, subtotal, tax_total, service_charge, discount_total, coupon_code, customer_id, register_session_id, staff_id, clerk_name, total, opened_at, closed_at, business_date, store_id, stores(name, address, phone), profiles(display_name), restaurant_tables(name)'
    )
    .eq('id', q.id)
    .maybeSingle();
  // 入口の確かめは Web のページと同じ（ほかの店の伝票は本部だけ）
  if (!order || (order.store_id !== store.id && !ctx.isHq)) return NOT_FOUND;

  const [{ data: items }, { data: payments }, { data: settings }, { data: refunds }, { data: pointTx }, { data: ryoshushoJobs }, { count: printerCount }] =
    await Promise.all([
      supabase
        .from('order_items')
        .select('id, name, unit_price, quantity, tax_rate, tax_included, line_total, modifiers')
        .eq('order_id', q.id)
        .eq('status', 'active')
        .order('created_at'),
      supabase.from('payments').select('method, amount, tendered, change_amount, paid_at').eq('order_id', q.id).order('paid_at'),
      supabase
        .from('store_settings')
        .select('receipt_header, receipt_footer, invoice_registration_number')
        .eq('store_id', order.store_id)
        .maybeSingle(),
      supabase.from('refunds').select('amount, kind').eq('order_id', q.id),
      supabase.from('point_transactions').select('kind, points').eq('order_id', q.id),
      // 領収書は一度きり（2026-09-26 Ronnie）。出したことがあるかを print_jobs から読む（Web と同じ）
      supabase
        .from('print_jobs')
        .select('job_type, status, printed_at, created_at, sheets:payload->sheets')
        .eq('order_id', q.id)
        .eq('job_type', 'ryoshusho'),
      // CloudPRNT のレシートプリンター（Web の「プリンタで印刷」と同じ判定）
      supabase
        .from('printer_configs')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', order.store_id)
        .eq('status', 'active')
        .eq('usage', 'receipt')
        .eq('cloudprnt_enabled', true),
    ]);

  let registerName: string | null = null;
  if (order.register_session_id) {
    const { data: session } = await supabase
      .from('register_sessions')
      .select('registers(name)')
      .eq('id', order.register_session_id)
      .maybeSingle();
    registerName = (session?.registers as unknown as { name: string } | null)?.name ?? null;
  }

  let pointBalance: number | null = null;
  if (order.customer_id) {
    const { data: cust } = await supabase.from('customers').select('point_balance').eq('id', order.customer_id).maybeSingle();
    pointBalance = (cust?.point_balance as number | null | undefined) ?? null;
  }
  const tx = (pointTx ?? []) as { kind: string; points: number }[];
  const pointsEarned = tx.filter((t) => t.kind === 'earn').reduce((a, t) => a + Number(t.points), 0);
  const pointsUsed = Math.abs(tx.filter((t) => t.kind === 'redeem').reduce((a, t) => a + Number(t.points), 0));

  const storeInfo = order.stores as unknown as { name: string; address: string | null; phone: string | null } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;

  const receipt = buildReceipt({
    store: {
      name: storeInfo?.name ?? '',
      address: storeInfo?.address ?? null,
      phone: storeInfo?.phone ?? null,
      registrationNumber: settings?.invoice_registration_number ?? null,
      headerMessage: settings?.receipt_header ?? null,
      footerMessage: settings?.receipt_footer ?? null,
    },
    order: {
      orderNo: order.order_no,
      closedAt: order.closed_at,
      openedAt: order.opened_at,
      subtotal: order.subtotal,
      taxTotal: order.tax_total,
      serviceCharge: order.service_charge,
      discountTotal: order.discount_total,
      couponCode: order.coupon_code,
      total: order.total,
    },
    items: (items ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
      taxRate: i.tax_rate,
      modifiers: (i.modifiers as { name: string; price: number }[] | null) ?? [],
    })),
    payments: (payments ?? []).map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, change: p.change_amount })),
    refunds: (refunds ?? []).map((r) => ({ amount: r.amount })),
    registerName,
    // 担当者（レジで選んだ名前）を優先する。Web のページ・印字と同じ
    staffName: order.clerk_name ?? staff?.display_name ?? null,
    tableName:
      (order.restaurant_tables as unknown as { name: string } | null)?.name ?? (order.order_type === 'takeout' ? 'テイクアウト' : null),
    guestCount: order.guest_count ?? null,
    isReissue: q.reissue,
    methodLabels: METHOD_LABELS,
    // 非会員注文ではポイント欄自体を出さない
    points: order.customer_id ? { earned: pointsEarned, used: pointsUsed, balance: pointBalance } : undefined,
  });

  return {
    body: buildNativeReceiptBody({
      orderId: order.id,
      status: String(order.status ?? ''),
      hasVoid: ((refunds ?? []) as { kind?: string | null }[]).some((r) => r.kind === 'void'),
      receipt,
      ryoshusho: ryoshushoIssuedFrom((ryoshushoJobs ?? []) as RyoshushoJobRow[]),
      printerReady: (printerCount ?? 0) > 0,
    }),
  };
};
