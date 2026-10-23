import { NextResponse } from 'next/server';
import { todayJst } from '@/lib/format';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { can, type PermissionAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { isUuid, NATIVE_APP_HEADER, parseNativePosAction, type NativePosAction } from '@/lib/native-pos';
import { loadNativeCatalog, loadNativeLive, loadNativeOrder, loadNativePos, setOrderVisitSource } from '@/lib/native-pos-server';
import { claimLanKitchenPrints, finishLanPrint } from '@/lib/native-print-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { checkout, splitOrder, sendOrderToKitchen, setDiscount, updateQty, addItem, startTakeout } from '@/app/app/pos/actions';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { cancelSteraPayment, checkSteraPayment, startSteraPayment } from '@/app/app/pos/stera-actions';
import { enqueueDrawerKick, enqueueExpoSlipPrint, enqueueOrderSlipPrint, enqueueReceiptPrint, enqueueSelectedItemsPrint, enqueueStockListPrint } from '@/app/app/pos/print-actions';
import { shouldOpenDrawer } from '@/lib/printing/types';
import { isNativeFloorActionType, parseNativeFloorAction, type NativeFloorAction } from '@/lib/native-floor';
import { loadNativeFloor } from '@/lib/native-floor-server';
import { loadNativeHome } from '@/lib/native-home-server';
import { isNativeLedgerActionType, parseNativeLedgerAction, type NativeLedgerAction } from '@/lib/native-ledger';
import { loadNativeLedger, loadNativeLedgerWait, loadNativeLedgerWeek } from '@/lib/native-ledger-server';
import { isNativeCashActionType, parseNativeCashAction, sumNativeDenominations, type NativeCashAction } from '@/lib/native-cash';
import { loadNativeCash, loadNativeCashIo } from '@/lib/native-cash-server';
import { isNativeQuickActionType, parseNativeQuickAction, type NativeQuickAction } from '@/lib/native-quick';
import { loadNativeQuick } from '@/lib/native-quick-server';
import { isNativeSlipActionType, parseNativeSlipAction, type NativeSlipAction } from '@/lib/native-slips';
import { loadNativeSlipDetail, loadNativeSlips } from '@/lib/native-slips-server';
import { refundOrder, reopenOrder } from '@/app/app/orders/actions';
import { isNativeExpenseActionType, parseNativeExpenseAction, type NativeExpenseAction } from '@/lib/native-expenses';
import { loadNativeExpenses } from '@/lib/native-expenses-server';
import { addExpense, approveExpense, rejectExpense, seedExpenseAccounts } from '@/app/app/expenses/actions';
import { createInvoice } from '@/app/app/invoices/actions';
import { isNativeStockActionType, parseNativeStockAction } from '@/lib/native-stock';
import { loadNativeStock } from '@/lib/native-stock-server';
import { setMenuStockLimits } from '@/app/app/inventory/menu-stock-actions';
import { prepareQuickCheckout, startQuickOrder } from '@/app/app/quick-pay/actions';
import { addCashTransaction, closeRegister, openRegister, printSettlementReport, reprintRegisterReport } from '@/app/app/cash/actions';
import {
  assignTables,
  cancelReservation,
  createManualReservation,
  createOrderForReservation,
  createWalkInReservation,
  createWaitingTicket,
  createWaitlistEntry,
  callWaitingTicket,
  cancelWaitlistEntry,
  guideWaitingTicketToOrder,
  markWaitingNoShow,
  markWaitlistContacted,
  markWaitlistExpired,
  getOccupiedTableIds,
  markNoShow,
  moveReservation,
  transitionReservationStatus,
  updateReservationClerk,
  updateReservationCourse,
  updateReservationMemo,
  updateReservationSource,
} from '@/app/app/reservations/actions';
import { addSlipToTable, cancelEmptyOrder, clearTable, mergeOrders, moveTable, setGuestCount, setPaymentMemo, setSeatTime } from '@/app/app/pos/actions';
import { completeCleaning, goToOrder, releaseFinishedCleaning, setTableAvailability } from '@/app/app/floor/actions';
import { saveTableGroup } from '@/app/app/floor/group-actions';
import { resolveServiceCall, startRegisterVisit } from '@/app/app/handy/actions';

/**
 * iPad アプリのネイティブ画面（オーダー・会計）用の入口（2026-10-13 Ronnie「Airレジのようにネイティブで」）。
 *   GET  ?order=<id>          … 画面を開くときの全部（メニュー・伝票・担当者・会計の選択肢・stera）
 *   GET  ?order=<id>&part=order … 伝票だけ（読み直し）
 *   GET  ?order=<id>&part=live  … 伝票・レジの開局・stera（軽い。メニューは iPad の保存から）
 *   GET  ?part=catalog[&store=<id>] … 店のメニューまわり（iPad に保存する。version で変わったか分かる）
 *   GET  ?part=floor[&store=<id>]   … フロア（テーブル一覧）の全部（卓・伝票・予約・呼び出し・お客様情報の選択肢。2026-10-24）
 *   POST { type, … }          … 注文確定（明細を入れて厨房へ）・数量・担当者・値引き・来店経路・会計・stera
 *   POST { type: 'floor…' }   … フロアの操作（着席・伝票を開く・清掃完了・ブロック・会計伝票・合算・お客様情報…。lib/native-floor.ts）
 * 中身は Web のレジと同じサーバーの処理（app/app/pos/*-actions.ts）。Web の画面は変えない。
 * アプリは必ず `x-tenpo-app: 1` を付ける（他のサイトから勝手に呼べないように）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

function fromApp(request: Request): boolean {
  return request.headers.get(NATIVE_APP_HEADER) === '1';
}

/** 現場で分かる言葉にする（サーバーのエラー文がそのまま出せないときの言い方は Web のレジと同じ） */
function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw)) return fallback;
  return raw;
}

/**
 * Server Action と同じ回線の制限（lib/auth.ts の requirePermission は Server Action のときだけ見るので、ここで同じことをする）:
 * ハンディ端末はお店の Wi-Fi から、レジの操作（とレジ端末のアカウントの全操作）はお店の回線からだけ。
 */
async function networkProblem(ctx: SessionContext): Promise<string | null> {
  if (ctx.isHandyDevice) {
    const { assertHandyOnShopNetwork } = await import('@/lib/handy-device-server');
    try {
      await assertHandyOnShopNetwork();
    } catch (e) {
      return errorText(e, ACCESS_MESSAGE.network);
    }
  }
  if (ctx.currentStore) {
    const { isRequestFromStoreNetwork } = await import('@/lib/store-access-server');
    if (!(await isRequestFromStoreNetwork(ctx.currentStore.id))) return ACCESS_MESSAGE.network;
  }
  return null;
}

/** フロアの操作ごとの権限（中の Server Action も同じ権限を見る） */
const FLOOR_PERMISSION: Record<NativeFloorAction['type'], PermissionAction> = {
  floorStart: 'tables.operate',
  floorOrder: 'pos.order',
  floorCleaned: 'tables.operate',
  floorBlock: 'tables.operate',
  floorGroup: 'tables.operate',
  floorMerge: 'pos.checkout',
  floorGuests: 'pos.order',
  floorMemo: 'pos.order',
  floorSeatTime: 'pos.order',
  floorBill: 'pos.order',
  floorReceipt: 'pos.checkout',
  floorExpo: 'pos.order',
  floorPrintSelected: 'pos.order',
  floorClear: 'pos.checkout',
  floorCall: 'pos.order',
  floorRelease: 'tables.operate',
  floorNewSlip: 'pos.order',
  floorMove: 'pos.checkout',
  floorCancelEmpty: 'pos.checkout',
  floorDrawer: 'pos.checkout',
};

const PERMISSION: Record<NativePosAction['type'], PermissionAction> = {
  split: 'pos.checkout',
  send: 'pos.order',
  qty: 'pos.order',
  clerk: 'pos.order',
  discount: 'pos.discount',
  checkout: 'pos.checkout',
  visitSource: 'pos.order',
  steraStart: 'pos.checkout',
  steraCheck: 'pos.checkout',
  steraCancel: 'pos.checkout',
  drawer: 'pos.checkout',
  printDone: 'pos.order',
};

export async function GET(request: Request) {
  if (!fromApp(request)) return json({ ok: false, error: 'アプリから開いてください' }, 400);
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId || !ctx.role) return json({ ok: false, error: 'ログインしてください' }, 401);
  if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
  if (ctx.disabledFeatures?.has('pos')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);

  const url = new URL(request.url);
  const part = url.searchParams.get('part');

  // 店のメニューまわり（伝票に寄らない。iPad に保存して次から先に出す。2026-10-21「メニューは超速く」）
  if (part === 'catalog') {
    const storeParam = url.searchParams.get('store');
    const storeId = isUuid(storeParam) ? storeParam : (ctx.currentStore?.id ?? ctx.stores[0]?.id ?? null);
    if (!storeId) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return json({ ok: false, error: '店舗がありません' }, 404);
    const catalog = await loadNativeCatalog(ctx, await createClient(), storeId, ctx.organizationId);
    return json({ ok: true, catalog });
  }

  // ホーム（売上・達成率・来店組数・左の列のボタン）。Web のレジのホームと同じ組み立て（lib/native-home-server.ts）
  if (part === 'home') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const home = await loadNativeHome(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...home });
  }

  // 店舗台帳（1日のスケジュール）。Web の店舗台帳と同じ組み立て（lib/native-ledger-server.ts）
  if (part === 'ledger') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const dateParam = url.searchParams.get('date');
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
    const ledger = await loadNativeLedger(ctx, await createClient(), store, date);
    return json({ ok: true, ...ledger });
  }

  // レジ開局・レジクローズ。Web の /app/cash/open と /app/cash/close（レジの iPad）と同じ組み立て（lib/native-cash-server.ts）
  if (part === 'cash') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const cash = await loadNativeCash(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...cash });
  }

  // iPhoneハンディの QR（Web の /app/settings/handy-qr を見るだけ。作り直し・回線の設定は管理画面）
  if (part === 'handyqr') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    const supabase = await createClient();
    const [{ data: row }, { count: activeDevices }, origin] = await Promise.all([
      supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
      supabase.from('handy_devices').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'active'),
      import('@/lib/site-origin').then((m) => m.resolveSiteOrigin()),
    ]);
    const { handyQrFrom, handyQrUrl } = await import('@/lib/handy-qr');
    const qr = handyQrFrom(row?.settings ?? null);
    return json({
      ok: true,
      store: { id: store.id, name: store.name },
      url: qr.token ? handyQrUrl(origin, qr.token) : null,
      wifiOnly: qr.wifiOnly,
      activeDevices: activeDevices ?? 0,
    });
  }

  // 在庫設定（本日の残り数。Web の /app/inventory/menu-stock）
  if (part === 'stock') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const stock = await loadNativeStock(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...stock });
  }

  // 仕入・経費（Web の /app/expenses。上にお知らせ&アラート）
  if (part === 'expenses') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const p = url.searchParams;
    const ex = await loadNativeExpenses(ctx, await createClient(), { id: store.id, name: store.name }, { from: p.get('from'), to: p.get('to'), account: p.get('account'), status: p.get('status') });
    return json({ ok: true, ...ex });
  }

  // 伝票明細（Web の /app/orders・/app/orders/[id]）
  if (part === 'slips') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const p = url.searchParams;
    const slips = await loadNativeSlips(ctx, await createClient(), { id: store.id, name: store.name }, {
      from: p.get('from'), to: p.get('to'), status: p.get('status'), method: p.get('method'), q: p.get('q'), page: p.get('page'),
    });
    return json({ ok: true, ...slips });
  }
  if (part === 'slip') {
    const id = url.searchParams.get('id');
    if (!isUuid(id)) return json({ ok: false, error: '伝票が正しくありません' }, 400);
    const detail = await loadNativeSlipDetail(ctx, await createClient(), id);
    if (!detail) return json({ ok: false, error: '注文が見つかりません' }, 404);
    return json({ ok: true, ...detail });
  }

  // 即会計（Web の /app/quick-pay）
  if (part === 'quick') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const quick = await loadNativeQuick(ctx, await createClient(), { id: store.id, name: store.name }, url.searchParams.get('order'));
    return json({ ok: true, ...quick });
  }

  // 入出金（Web の /app/cash のレジ入出金タブ）
  if (part === 'cashio') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const io = await loadNativeCashIo(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...io });
  }

  // 店舗台帳のウェイティング（Web の view=waitlist）
  if (part === 'ledgerWait') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const wait = await loadNativeLedgerWait(await createClient(), store, url.searchParams.get('wstatus'), todayJst());
    return json({ ok: true, ...wait });
  }

  // 店舗台帳の週間（Web の view=week と同じ集計）
  if (part === 'ledgerWeek') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const dateParam = url.searchParams.get('date');
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
    const week = await loadNativeLedgerWeek(await createClient(), store, date, todayJst());
    return json({ ok: true, ...week });
  }

  // フロア（テーブル一覧）。Web のテーブル一覧と同じ組み立て（lib/floor-view-server.ts）
  if (part === 'floor') {
    const storeParam = url.searchParams.get('store');
    const store = isUuid(storeParam)
      ? (ctx.stores.find((s) => s.id === storeParam) ?? (ctx.isHq ? ctx.currentStore : null))
      : (ctx.currentStore ?? ctx.stores[0] ?? null);
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const { loadStoreAccess, peekRegisterDevice } = await import('@/lib/store-access-server');
    const { policy, onNetwork } = await loadStoreAccess(store.id);
    if (!onNetwork) return json({ ok: false, error: ACCESS_MESSAGE.network, useWeb: true }, 403);
    const { decision } = await peekRegisterDevice(store.id, policy);
    if (decision.kind !== 'allowed') return json({ ok: false, error: 'このiPadをレジとして登録してください', useWeb: true }, 403);
    const floor = await loadNativeFloor(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...floor });
  }

  const orderId = url.searchParams.get('order');
  if (!isUuid(orderId)) return json({ ok: false, error: '伝票が正しくありません' }, 400);

  if (part === 'order') {
    const order = await loadNativeOrder(await createClient(), ctx, orderId);
    if (!order) return json({ ok: false, error: '注文が見つかりません' }, 404);
    return json({ ok: true, order });
  }
  if (part === 'live') {
    const live = await loadNativeLive(ctx, await createClient(), orderId);
    if ('ok' in live) return json(live, live.status);
    return json({ ok: true, ...live });
  }

  // お店の回線・レジ端末の台数（Web のレジ画面と同じ）。引っかかったら Web の画面で開いてもらう（登録の画面が出る）
  const { data: row } = await (await createClient()).from('orders').select('store_id').eq('id', orderId).maybeSingle();
  if (row?.store_id) {
    const { loadStoreAccess, peekRegisterDevice } = await import('@/lib/store-access-server');
    const { policy, onNetwork } = await loadStoreAccess(row.store_id as string);
    if (!onNetwork) return json({ ok: false, error: ACCESS_MESSAGE.network, useWeb: true }, 403);
    const { decision } = await peekRegisterDevice(row.store_id as string, policy);
    if (decision.kind !== 'allowed') return json({ ok: false, error: 'このiPadをレジとして登録してください', useWeb: true }, 403);
  }

  const result = await loadNativePos(ctx, orderId);
  if (!result.ok) return json(result, result.status);
  return json(result);
}

export async function POST(request: Request) {
  if (!fromApp(request)) return json({ ok: false, error: 'アプリから操作してください' }, 400);
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId || !ctx.role) return json({ ok: false, error: 'ログインしてください' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: '内容が正しくありません' }, 400);
  }
  // 店舗台帳（予約）の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeLedgerActionType((raw as { type?: unknown }).type)) {
    const parsedLedger = parseNativeLedgerAction(raw);
    if (!parsedLedger.ok) return json({ ok: false, error: parsedLedger.error }, 400);
    const action = parsedLedger.action;
    const ledgerPerm: PermissionAction = action.type === 'ledgerSeat' ? 'pos.order' : action.type === 'ledgerFindSeats' ? 'reservations.view' : 'reservations.write';
    if (!can(ctx.role, ledgerPerm)) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runLedgerAction(ctx, action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 在庫設定の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeStockActionType((raw as { type?: unknown }).type)) {
    const parsedStock = parseNativeStockAction(raw);
    if (!parsedStock.ok) return json({ ok: false, error: parsedStock.error }, 400);
    const store = ctx.currentStore ?? ctx.stores[0];
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const stockProblem = await networkProblem(ctx);
    if (stockProblem) return json({ ok: false, error: stockProblem }, 403);
    try {
      if (parsedStock.action.type === 'stockSave') {
        const r = await setMenuStockLimits(store.id, parsedStock.action.entries);
        return json(r.error ? { ok: false, error: r.error } : { ok: true, queued: r.saved ?? parsedStock.action.entries.length });
      }
      const r = await enqueueStockListPrint(store.id, parsedStock.action.lines);
      return json(r.ok ? { ok: true } : { ok: false, error: r.error ?? '在庫の印刷に失敗しました' });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 仕入・経費の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeExpenseActionType((raw as { type?: unknown }).type)) {
    const parsedEx = parseNativeExpenseAction(raw);
    if (!parsedEx.ok) return json({ ok: false, error: parsedEx.error }, 400);
    const action = parsedEx.action;
    const need: PermissionAction =
      action.type === 'expenseApprove' || action.type === 'expenseReject' || action.type === 'expenseSeed' ? 'cash.approve' : action.type === 'expenseBill' ? 'documents.write' : 'cash.write';
    if (!can(ctx.role, need)) return json({ ok: false, error: '権限がありません' }, 403);
    const expenseProblem = await networkProblem(ctx);
    if (expenseProblem) return json({ ok: false, error: expenseProblem }, 403);
    try {
      return json(await runExpenseAction(ctx, action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 伝票明細の操作（返金・取消・再会計・領収書・レシート再発行。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeSlipActionType((raw as { type?: unknown }).type)) {
    const parsedSlip = parseNativeSlipAction(raw);
    if (!parsedSlip.ok) return json({ ok: false, error: parsedSlip.error }, 400);
    const action = parsedSlip.action;
    const need: PermissionAction = action.type === 'slipRefund' || action.type === 'slipReopen' ? 'pos.refund' : 'pos.checkout';
    if (!can(ctx.role, need)) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runSlipAction(action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 即会計の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeQuickActionType((raw as { type?: unknown }).type)) {
    const parsedQuick = parseNativeQuickAction(raw);
    if (!parsedQuick.ok) return json({ ok: false, error: parsedQuick.error }, 400);
    const action = parsedQuick.action;
    if (!can(ctx.role, action.type === 'quickCheckout' ? 'pos.checkout' : 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runQuickAction(action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // レジ開局・レジクローズの操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeCashActionType((raw as { type?: unknown }).type)) {
    const parsedCash = parseNativeCashAction(raw);
    if (!parsedCash.ok) return json({ ok: false, error: parsedCash.error }, 400);
    const action = parsedCash.action;
    if (action.type !== 'cashSignOut' && !can(ctx.role, 'register.operate')) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = action.type === 'cashSignOut' ? null : await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runCashAction(ctx, action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // フロア（テーブル一覧）の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeFloorActionType((raw as { type?: unknown }).type)) {
    const parsedFloor = parseNativeFloorAction(raw);
    if (!parsedFloor.ok) return json({ ok: false, error: parsedFloor.error }, 400);
    const action = parsedFloor.action;
    if (!can(ctx.role, FLOOR_PERMISSION[action.type])) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runFloorAction(action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  const parsed = parseNativePosAction(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const action = parsed.action;
  if (!can(ctx.role, PERMISSION[action.type])) return json({ ok: false, error: '権限がありません' }, 403);
  const problem = await networkProblem(ctx);
  if (problem) return json({ ok: false, error: problem }, 403);

  /** 操作のあとの伝票（アプリの画面をサーバーの値にそろえる） */
  const freshOrder = async (orderId: string) => loadNativeOrder(await createClient(), ctx, orderId);

  try {
    switch (action.type) {
      case 'send': {
        // Web のレジの「注文確定」と同じ：カートの品を伝票に入れてから、まとめて厨房へ
        for (const l of action.lines) {
          await addItem(action.orderId, l.menuItemId, l.optionItemIds, l.quantity, l.openPrice);
        }
        const res = await sendOrderToKitchen(action.orderId);
        // その場で厨房伝票を作り、iPad から LAN で直接出せる分は印刷データを返事に付ける（2026-10-21「印刷は超速く」）
        const supabase = await createClient();
        const [order, { data: row }] = await Promise.all([
          freshOrder(action.orderId),
          supabase.from('orders').select('store_id').eq('id', action.orderId).maybeSingle(),
        ]);
        const prints = row?.store_id ? await claimLanKitchenPrints(createAdminClient(), row.store_id as string) : [];
        return json({ ok: true, printWarning: res.printWarning ?? null, order, prints });
      }
      case 'printDone': {
        const admin = createAdminClient();
        const { data: p } = await admin.from('printer_configs').select('id, organization_id, store_id').eq('id', action.printerId).maybeSingle();
        if (!p || p.organization_id !== ctx.organizationId || (!ctx.isHq && !ctx.stores.some((s) => s.id === p.store_id))) {
          return json({ ok: false, error: 'プリンターが見つかりません' }, 404);
        }
        await finishLanPrint(admin, action.printerId, action.jobId, action.result, action.code);
        return json({ ok: true });
      }
      case 'split': {
        const result = await splitOrder(action.orderId, action.moves);
        return json({ ok: true, newOrderId: result.newOrderId, order: await freshOrder(result.newOrderId) });
      }
      case 'qty':
        await updateQty(action.orderId, action.lineId, action.delta);
        return json({ ok: true, order: await freshOrder(action.orderId) });
      case 'clerk': {
        const res = await setOrderClerk(action.orderId, action.clerkId);
        if (!res.ok) return json({ ok: false, error: res.error ?? '担当者を変えられませんでした' }, 400);
        return json({ ok: true, order: await freshOrder(action.orderId) });
      }
      case 'discount':
        await setDiscount(action.orderId, action.amount, action.reason);
        return json({ ok: true, order: await freshOrder(action.orderId) });
      case 'visitSource': {
        const res = await setOrderVisitSource(ctx, action.orderId, action.sourceId);
        if (!res.ok) return json({ ok: false, error: res.error }, 400);
        return json({ ok: true, order: await freshOrder(action.orderId) });
      }
      case 'checkout': {
        const outcome = await checkout(action.orderId, action.payments, action.memo || undefined, action.bluetoothLink);
        if (outcome.registerClosed) {
          return json(
            { ok: false, registerClosed: true, error: 'レジが未開局のため会計できません。「レジクローズ」画面で釣銭準備金を数えてレジを開局してください' },
            409
          );
        }
        return json({ ok: true, alreadyPaid: !!outcome.alreadyPaid, warning: outcome.warning ?? null, pointsEarned: outcome.pointsEarned ?? 0, ...(outcome.receipt ? { receipt: outcome.receipt } : {}) });
      }
      case 'steraStart':
        return json(await startSteraPayment(action.orderId, action.terminalId, action.paymentType));
      case 'steraCheck':
        return json(await checkSteraPayment(action.requestId));
      case 'steraCancel':
        return json(await cancelSteraPayment(action.requestId));
      case 'drawer': {
        // Web のレジ（pos-screen の attemptOpenDrawer）と同じ：店の設定で開くか決めて、レジのプリンターにドロアを積む
        const supabase = await createClient();
        const { data: order } = await supabase.from('orders').select('store_id').eq('id', action.orderId).maybeSingle();
        if (!order || !(ctx.isHq || ctx.stores.some((s) => s.id === order.store_id))) return json({ ok: false, error: '注文が見つかりません' }, 404);
        const { data: st } = await supabase.from('store_settings').select('settings').eq('store_id', order.store_id).maybeSingle();
        const d = (st?.settings as { drawer?: { autoOpenOnCash?: boolean; openOnCashless?: boolean } } | null)?.drawer;
        const config = { autoOpenOnCash: d?.autoOpenOnCash ?? true, openOnCashless: d?.openOnCashless ?? false };
        if (!shouldOpenDrawer(action.methods, config)) return json({ ok: true, opened: false });
        const res = await enqueueDrawerKick(order.store_id as string);
        return json({ ok: true, opened: res.ok, error: res.ok ? undefined : res.error });
      }
    }
  } catch (e) {
    return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
  }
}

/** フロアの操作。中身は Web のテーブル一覧のポップアップと同じ Server Action */
async function runFloorAction(action: NativeFloorAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'floorStart': {
      // プラン商品は「未送信」で伝票へ（レジのファーストオーダーと同じ。厨房へは注文画面の注文確定で）
      const res = await startRegisterVisit(action.tableId, action.draft);
      return { ok: true, orderId: res.orderId, planItemError: res.planItemError };
    }
    case 'floorOrder': {
      const res = await goToOrder(action.tableId);
      return { ok: true, orderId: res.orderId };
    }
    case 'floorCleaned':
      await completeCleaning(action.tableId);
      return { ok: true };
    case 'floorBlock':
      await setTableAvailability(action.tableId, action.unavailable);
      return { ok: true };
    case 'floorGroup': {
      const res = await saveTableGroup(action.tableIds);
      if (res.error) return { ok: false, error: res.error };
      return { ok: true };
    }
    case 'floorMerge':
      await mergeOrders(action.targetOrderId, action.sourceOrderId);
      return { ok: true };
    case 'floorGuests':
      await setGuestCount(action.orderId, action.guestCount);
      return { ok: true };
    case 'floorMemo': {
      const res = await setPaymentMemo(action.orderId, action.memo);
      if (res.error) return { ok: false, error: res.error };
      return { ok: true };
    }
    case 'floorSeatTime':
      await setSeatTime(action.orderId, action.input);
      return { ok: true };
    case 'floorBill': {
      const res = await enqueueOrderSlipPrint(action.orderId);
      return res.ok ? { ok: true, queued: res.queued ?? 0 } : { ok: false, error: res.error ?? 'お会計伝票の印刷に失敗しました' };
    }
    case 'floorReceipt': {
      const res = await enqueueReceiptPrint(action.orderId, { reissue: true });
      return res.ok ? { ok: true, queued: res.queued ?? 0 } : { ok: false, error: res.error ?? 'レシートを再発行できませんでした' };
    }
    case 'floorExpo': {
      const res = await enqueueExpoSlipPrint(action.orderId);
      return res.ok ? { ok: true, queued: res.queued ?? 0 } : { ok: false, error: res.error ?? 'デシャップ伝票の印刷に失敗しました' };
    }
    case 'floorPrintSelected': {
      const res = await enqueueSelectedItemsPrint(action.orderId, action.itemIds);
      return res.ok ? { ok: true, queued: res.queued ?? 0 } : { ok: false, error: res.error ?? '選択印刷に失敗しました' };
    }
    case 'floorClear': {
      const res = await clearTable(action.orderId, action.reason, action.approvedByClerkId);
      return { ok: true, cancelledItems: res.cancelledItems };
    }
    case 'floorCall': {
      const res = await resolveServiceCall(action.callId);
      return { ok: true, alreadyResolved: res.alreadyResolved };
    }
    case 'floorRelease': {
      const res = await releaseFinishedCleaning(action.storeId);
      return { ok: true, released: res.released };
    }
    case 'floorNewSlip': {
      const res = await addSlipToTable(action.orderId);
      return { ok: true, orderId: res.newOrderId, orderNo: res.orderNo };
    }
    case 'floorMove': {
      const res = await moveTable(action.orderId, action.tableId);
      return { ok: true, tableName: res.tableName };
    }
    case 'floorCancelEmpty':
      await cancelEmptyOrder(action.orderId, action.reason, action.approvedByClerkId);
      return { ok: true };
    case 'floorDrawer': {
      // ホームの「ドロアオープン」（Web の DrawerRow と同じ）
      const res = await enqueueDrawerKick(action.storeId);
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'ドロアを開けられませんでした' };
    }
  }
}

/** 店舗台帳の操作。中身は Web の予約台帳と同じ Server Action */
/** 仕入・経費。Web の ExpenseFormDialog / VendorBillDialog / ApprovalActions と同じ Server Action */
async function runExpenseAction(ctx: SessionContext, action: NativeExpenseAction): Promise<Record<string, unknown>> {
  const store = ctx.currentStore ?? ctx.stores[0];
  switch (action.type) {
    case 'expenseAdd':
      if (!store) return { ok: false, error: '店舗がありません' };
      await addExpense({
        storeId: store.id,
        expenseAccountId: action.expenseAccountId,
        amount: action.amount,
        taxAmount: action.taxAmount,
        paidVia: action.paidVia,
        vendorName: action.vendorName,
        memo: action.memo,
        businessDate: action.businessDate,
      });
      return { ok: true };
    case 'expenseBill':
      if (!store) return { ok: false, error: '店舗がありません' };
      await createInvoice({
        storeId: store.id,
        vendorId: action.vendorId,
        vendorName: action.vendorName,
        invoiceNo: null,
        issueDate: action.date,
        dueDate: null,
        amount: action.amount,
        taxAmount: 0,
        registrationNumber: null,
        paymentMethod: null,
        expenseAccountId: null,
        note: action.memo,
        file: null,
      });
      return { ok: true };
    case 'expenseApprove':
      await approveExpense(action.id);
      return { ok: true };
    case 'expenseReject':
      await rejectExpense(action.id, action.reason);
      return { ok: true };
    case 'expenseSeed':
      await seedExpenseAccounts();
      return { ok: true };
  }
}

/** 伝票明細。Web の RefundDialog / ReopenDialog / レシート・領収書と同じ Server Action */
async function runSlipAction(action: NativeSlipAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'slipRefund':
      await refundOrder(action.orderId, action.amount, action.method, action.reason, action.kind, action.items ?? undefined);
      return { ok: true };
    case 'slipReopen': {
      const { orderId } = await reopenOrder(action.orderId, action.reason);
      return { ok: true, orderId };
    }
    case 'slipRyoshusho': {
      const r = await enqueueReceiptPrint(action.orderId, {
        jobType: 'ryoshusho',
        recipientName: action.recipientName,
        purpose: action.purpose,
        splitAmounts: action.splitAmounts,
      });
      return r.ok ? { ok: true, queued: r.queued ?? null } : { ok: false, error: r.error ?? '領収書を印刷できませんでした' };
    }
    case 'slipReceipt': {
      const r = await enqueueReceiptPrint(action.orderId, { reissue: true });
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'レシートを印刷できませんでした' };
    }
  }
}

/** 即会計。Web の QuickPayScreen と同じ Server Action（startQuickOrder / prepareQuickCheckout / startTakeout） */
async function runQuickAction(action: NativeQuickAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'quickStart': {
      const { orderId } = await startQuickOrder(action.guestCount);
      return { ok: true, orderId };
    }
    case 'quickTakeout': {
      const { orderId } = await startTakeout();
      return { ok: true, orderId };
    }
    case 'quickCheckout': {
      const r = await prepareQuickCheckout({ orderId: action.orderId, guestCount: action.guestCount, lines: action.lines, discount: action.discount });
      if (r.error || !r.orderId) return { ok: false, error: r.error ?? '会計に進めませんでした', orderId: r.orderId ?? null };
      return { ok: true, orderId: r.orderId };
    }
  }
}

/** レジ開局・レジクローズ。Web の RegisterOpenCard / RegisterCountCard / RegisterClosedCard と同じ Server Action を呼ぶ */
async function runCashAction(ctx: SessionContext, action: NativeCashAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'cashOpen': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      // レジはこの店のもの（有効）だけ。別の店のレジ ID で開局させない
      const { data: reg } = await (await createClient())
        .from('registers')
        .select('id')
        .eq('id', action.registerId)
        .eq('store_id', store.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!reg) return { ok: false, error: 'レジが見つかりません' };
      const openingFloat = sumNativeDenominations(action.denominations);
      const r = await openRegister(store.id, action.registerId, openingFloat, action.denominations, action.reason, action.clerkName);
      return r.ok ? { ok: true, openingFloat } : { ok: false, error: r.error };
    }
    case 'cashClose': {
      const counted = sumNativeDenominations(action.denominations);
      const r = await closeRegister(action.sessionId, counted, action.reason, action.denominations, action.clerkName);
      return r.ok ? { ok: true, printWarning: r.printWarning ?? null, signOutAfter: r.signOutAfter === true } : { ok: false, error: r.error };
    }
    case 'cashReprint': {
      const r = await reprintRegisterReport(action.sessionId);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    case 'cashSettlement': {
      const r = await printSettlementReport(action.sessionId);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    case 'cashEntry': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      await addCashTransaction({ storeId: store.id, registerSessionId: action.sessionId, kind: action.kind, amount: action.amount, purpose: action.purpose });
      return { ok: true };
    }
    case 'cashSignOut': {
      // レジ端末はレジ締めのあとログアウト（Web の signOutRegister と同じ。Cookie はアプリの WebView にも戻る）
      const supabase = await createClient();
      await supabase.auth.signOut({ scope: 'local' });
      return { ok: true };
    }
  }
}

async function runLedgerAction(ctx: SessionContext, action: NativeLedgerAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'ledgerCreate': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const i = action.input;
      const res = (await createManualReservation({
        storeId: store.id,
        date: i.date,
        time: i.time,
        adults: i.adults,
        children: i.children,
        name: i.name,
        kana: i.kana || undefined,
        phone: i.phone,
        note: i.note || undefined,
        sourceCode: i.sourceCode,
        courseId: i.courseId,
        tableIds: i.tableIds,
        stayMinutes: i.stayMinutes,
        status: i.status,
        clerkId: i.clerkId,
        waitlistEntryId: i.waitlistEntryId ?? undefined,
      })) as unknown as { reservationId?: string; id?: string } | void;
      return { ok: true, reservationId: res && typeof res === 'object' ? (res.reservationId ?? res.id ?? null) : null };
    }
    case 'ledgerStatus':
      await transitionReservationStatus(action.reservationId, action.toStatus);
      return { ok: true };
    case 'ledgerCancel':
      await cancelReservation(action.reservationId, action.reason);
      return { ok: true };
    case 'ledgerNoShow':
      await markNoShow(action.reservationId, action.reason || undefined);
      return { ok: true };
    case 'ledgerTables':
      await assignTables(action.reservationId, action.tableIds);
      return { ok: true };
    case 'ledgerMove':
      await moveReservation(action.reservationId, { date: action.date, time: action.time, stayMinutes: action.stayMinutes });
      return { ok: true };
    case 'ledgerMemo':
      await updateReservationMemo(action.reservationId, action.memo);
      return { ok: true };
    case 'ledgerClerk':
      await updateReservationClerk(action.reservationId, action.clerkId);
      return { ok: true };
    case 'ledgerSource':
      await updateReservationSource(action.reservationId, action.sourceId);
      return { ok: true };
    case 'ledgerCourse':
      await updateReservationCourse(action.reservationId, action.courseId);
      return { ok: true };
    case 'ledgerSeat': {
      const orderId = await createOrderForReservation(action.reservationId);
      return { ok: true, orderId };
    }
    // 空席検索（Web の FindSeatsDialog と同じ：その時間帯に割当のない卓。清掃バッファも考慮）
    case 'ledgerFindSeats': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const startMs = new Date(`${action.date}T${action.time}:00+09:00`).getTime();
      const occupied = new Set(await getOccupiedTableIds(store.id, new Date(startMs).toISOString(), new Date(startMs + action.stayMinutes * 60000).toISOString()));
      const supabase = await createClient();
      const { data: tables } = await supabase
        .from('restaurant_tables')
        .select('id, name, capacity_min, capacity_max')
        .eq('store_id', store.id)
        .eq('status', 'active')
        .order('sort_order');
      const free = (tables ?? []).filter((t) => !occupied.has(t.id as string));
      const fit = free.filter((t) => (t.capacity_max as number) >= action.partySize);
      const { suggestTables } = await import('@/lib/reservations');
      const suggestion = suggestTables(
        free.map((t) => ({ id: t.id as string, name: t.name as string, capacityMin: t.capacity_min as number, capacityMax: t.capacity_max as number, isActive: true, isOccupied: false })),
        action.partySize
      )[0];
      return {
        ok: true,
        free: fit.map((t) => ({ id: t.id, name: t.name, capacityMin: t.capacity_min, capacityMax: t.capacity_max })),
        busyCount: occupied.size,
        suggestion: suggestion?.label ?? null,
      };
    }
    case 'ledgerWaitCall':
      await callWaitingTicket(action.entryId);
      return { ok: true };
    case 'ledgerWaitNoShow':
      await markWaitingNoShow(action.entryId);
      return { ok: true };
    case 'ledgerWaitCancel':
      await cancelWaitlistEntry(action.entryId);
      return { ok: true };
    case 'ledgerWaitContacted':
      await markWaitlistContacted(action.entryId);
      return { ok: true };
    case 'ledgerWaitExpired':
      await markWaitlistExpired(action.entryId);
      return { ok: true };
    case 'ledgerWaitGuide': {
      const orderId = await guideWaitingTicketToOrder(action.entryId, action.tableId);
      return { ok: true, orderId };
    }
    case 'ledgerWaitTicket': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const r = await createWaitingTicket({ storeId: store.id, name: action.name, partySize: action.partySize, phone: action.phone || undefined, seatPreference: action.seatPreference || undefined });
      return { ok: true, queued: r.ticketNo };
    }
    case 'ledgerWaitlistAdd': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      await createWaitlistEntry({
        storeId: store.id,
        name: action.name,
        phone: action.phone,
        partySize: action.partySize,
        desiredDate: action.desiredDate,
        timeFrom: action.timeFrom ?? undefined,
        timeTo: action.timeTo ?? undefined,
        note: action.note || undefined,
      });
      return { ok: true };
    }
    // 直接来店（ウォークイン登録。Web の WalkInDialog と同じ）
    case 'ledgerWalkIn': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const r = await createWalkInReservation({
        storeId: store.id,
        tableId: action.tableId,
        adults: action.adults,
        children: action.children,
        name: action.name || undefined,
        phone: action.phone || undefined,
      });
      return { ok: true, reservationId: r.reservationId };
    }
  }
}
