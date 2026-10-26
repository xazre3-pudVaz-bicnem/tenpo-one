import { NextResponse } from 'next/server';
import { daysAgoJst, todayJst } from '@/lib/format';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { NATIVE_MODULE_GET, NATIVE_MODULE_POST } from '@/lib/native-modules/registry';
import { can, type PermissionAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { isNativeCustomLine, isUuid, NATIVE_APP_HEADER, parseNativePosAction, type NativePosAction, type NativePrintJob } from '@/lib/native-pos';
import { loadNativeOfflineKit } from '@/lib/native-offline-kit-server';
import { parseOfflineSync } from '@/lib/native-offline-sync';
import { syncOfflineOrder } from '@/lib/native-offline-sync-server';
import { loadNativeCatalog, loadNativeLive, loadNativeOrder, loadNativePos, setOrderVisitSource } from '@/lib/native-pos-server';
import { claimLanKitchenPrints, finishLanPrint } from '@/lib/native-print-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { checkout, splitOrder, divideOrderItem, cancelItem, sendOrderToKitchen, setDiscount, updateQty, addItem, addCustomPriceItem, startTakeout } from '@/app/app/pos/actions';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { cancelSteraPayment, checkSteraPayment, startSteraPayment } from '@/app/app/pos/stera-actions';
import { enqueueDrawerKick, enqueueExpoSlipPrint, enqueueOrderSlipPrint, enqueueReceiptPrint, enqueueSelectedItemsPrint, enqueueStockListPrint } from '@/app/app/pos/print-actions';
import { shouldOpenDrawer } from '@/lib/printing/types';
import { isNativeFloorActionType, parseNativeFloorAction, pickNativeFloorStore, type NativeFloorAction } from '@/lib/native-floor';
import { loadNativeFloor } from '@/lib/native-floor-server';
import { loadNativeHome } from '@/lib/native-home-server';
import { isNativeHandyActionType, parseNativeHandyAction } from '@/lib/native-handy';
import { loadNativeHandy, runNativeHandyAction } from '@/lib/native-handy-server';
import { loadNativeOwnerHome } from '@/lib/native-owner-home-server';
import { loadNativeBudgetAuto, loadNativeBudgetDaily } from '@/lib/native-budget-server';
import { isNativeLedgerActionType, parseNativeLedgerAction, type NativeLedgerAction } from '@/lib/native-ledger';
import { loadNativeLedger, loadNativeLedgerMonth, loadNativeLedgerWait, loadNativeLedgerWeek } from '@/lib/native-ledger-server';
import { loadReservationEntryData } from '@/lib/reservation-entry-server';
import { loadReservationInbox } from '@/lib/reservation-inbox-server';
import { saveReservationKeywords, saveReservationTagGroups } from '@/app/app/reservations/label-actions';
import { isNativeGourmetActionType, parseNativeGourmetAction } from '@/lib/native-gourmet';
import { loadNativeGourmet } from '@/lib/native-gourmet-server';
import { markGourmetSiteRegistered, regenerateGourmetMailToken, resolveGourmetMailImport, setGourmetMailEnabled } from '@/app/app/settings/reservation-book/actions';
import { isNativeCashActionType, parseNativeCashAction, sumNativeDenominations, type NativeCashAction } from '@/lib/native-cash';
import { directDrawerBytes } from '@/lib/drawer-bluetooth-server';
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
import { isNativeInventoryActionType, nativeInventoryPermission, parseNativeInventoryAction } from '@/lib/native-inventory';
import { isNativePurchasingActionType, parseNativePurchasingAction } from '@/lib/native-purchasing';
import { isNativeCouponActionType, parseNativeCouponAction } from '@/lib/native-coupons';
import { isNativeMenuPagesActionType, parseNativeMenuPagesAction } from '@/lib/native-menu-pages';
import { isNativeVisitEditType, parseNativeVisitEdit } from '@/lib/native-visit-edit';
import { loadVisitEdit, saveVisitEdit } from '@/lib/native-visit-edit-server';
import { loadNativeMenuPages } from '@/lib/native-menu-pages-server';
import { saveMenuBookPages } from '@/app/app/settings/menu-book/actions';
import { loadCouponsData } from '@/lib/coupons-data-server';
import { generateCouponCode, getCouponRedemptions, saveCoupon, setCouponStatus } from '@/app/app/coupons/actions';
import { loadNativePoNew } from '@/lib/native-purchasing-server';
import { loadPurchaseOrderDetail, loadPurchaseOrderRows, loadVendorRows } from '@/lib/purchasing-data-server';
import { createVendor, deleteVendor, getVendorRecentOrders, updateVendor } from '@/app/app/vendors/actions';
import { cancelPurchaseOrder, changePurchaseOrderStatus, createPurchaseOrder, receiveItems } from '@/app/app/purchases/actions';
import { loadNativeInventory, loadNativeInventoryCount, NATIVE_INVENTORY_TABS, type NativeInventoryTab } from '@/lib/native-inventory-server';
import {
  addMovement,
  cancelStockTransfer,
  createItem,
  finalizeCount,
  getMovementHistory,
  getPurchaseHistory,
  receiveStockTransfer,
  requestStockTransfer,
  saveCounts,
  shipStockTransfer,
  startCount,
  transferStock,
  updateItem,
} from '@/app/app/inventory/actions';
import { prepareQuickCheckout, startQuickOrder } from '@/app/app/quick-pay/actions';
import {
  addCashTransaction,
  addPettyCash,
  approveClosing,
  approvePettyCash,
  approvePettyCashCount,
  closeRegister,
  openRegister,
  printPeriodReport,
  printSettlementReport,
  recordPettyCashCount,
  rejectPettyCash,
  reopenClosing,
  reopenStoreDay,
  reprintRegisterReport,
  updatePettyOpeningBalance,
} from '@/app/app/cash/actions';
import { isNativeNoticeActionType, parseNativeNoticeAction } from '@/lib/native-notices';
import { isNativeSettingsActionType, parseNativeSettingsAction } from '@/lib/native-settings';
import { isNativeSettingsPageActionType, parseNativeSettingsPageAction } from '@/lib/native-settings-pages';
import { isNativeSettingsPagePart, loadNativeSettingsPage, runNativeSettingsPageAction } from '@/lib/native-settings-pages-server';
import { loadNativeSettings } from '@/lib/native-settings-server';
import { currentDeviceSetting } from '@/lib/register-device-server';
import { addDeviceReceiptPrinter, saveDeviceReceiptPrinterSettings, setDevicePrinter } from '@/app/app/pos/device-printer-actions';
import { loadNativeAnnouncements, loadNativeNotices } from '@/lib/native-notices-server';
import { createAnnouncement, deleteAnnouncement, markAnnouncementRead } from '@/app/app/announcements/actions';
import { markAllRead } from '@/app/app/notifications/actions';
import { markNotificationRead } from '@/app/app/actions';
import { loadReportData } from '@/lib/reports-data-server';
import { isNativeScanActionType, nativeScanDayPath, nativeScanPath, parseNativeScanAction } from '@/lib/native-scan';
import { loadNativeScan } from '@/lib/native-scan-server';
import { attachReceiptToCashTransaction, createScanDocument } from '@/app/app/scan/actions';
import { isNativeCustomerActionType, nativeCustomerPermission, parseNativeCustomerAction } from '@/lib/native-customers';
import { loadNativeCustomer, loadNativeCustomers } from '@/lib/native-customers-server';
import { loadDuplicateGroups, loadRfmCustomers } from '@/lib/customers-analysis-server';
import {
  addCustomerNote,
  adjustCustomerPoints,
  anonymizeCustomer,
  attachCustomerTag,
  createCustomer,
  createCustomerTag,
  deleteCustomer,
  detachCustomerTag,
  mergeCustomers,
  recalcCustomerStats,
  searchCustomersForMerge,
  updateCustomerAttributes,
  updateCustomerBasic,
  updateCustomerConsent,
  updateCustomerMemberNo,
  updateCustomerMemberRank,
} from '@/app/app/customers/actions';
import { searchCustomerByPhone, setOrderCustomer } from '@/app/app/pos/actions';
import { isNativeBudgetActionType, parseNativeBudgetAction } from '@/lib/native-budget';
import { saveDailyBudgets } from '@/app/app/budgets/daily-actions';
import { saveMonthlySalesTarget, upsertBudget } from '@/app/app/budgets/actions';
import { loadNativeBudgets } from '@/lib/native-budgets-server';
import { isNativeBookingActionType, parseNativeBookingAction } from '@/lib/native-booking';
import { importStorePhotoFromPage, updateBookingSettings } from '@/app/app/settings/booking/actions';
import { ADMIN_ONLY_SETTINGS_NOTE } from '@/lib/admin-only-settings';
import { isNativePettyActionType, nativePettyPermission, parseNativePettyAction } from '@/lib/native-petty';
import { loadNativeClosings, loadNativePetty } from '@/lib/native-petty-server';
import {
  acknowledgeReservation,
  assignTables,
  cancelReservation,
  confirmPendingReservation,
  markReservationContacted,
  resolveInboxImport,
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
import { isNativeTableQrActionType, parseNativeTableQrAction } from '@/lib/native-table-qr';
import { loadNativeTableQr } from '@/lib/native-table-qr-server';
import { invalidateTableQrToken, regenerateTableQrToken } from '@/app/app/settings/tables/actions';

/**
 * iPad アプリのネイティブ画面（オーダー・会計）用の入口（2026-10-13 Ronnie「Airレジのようにネイティブで」）。
 *   GET  ?order=<id>          … 画面を開くときの全部（メニュー・伝票・担当者・会計の選択肢・stera）
 *   GET  ?order=<id>&part=order … 伝票だけ（読み直し）
 *   GET  ?order=<id>&part=live  … 伝票・レジの開局・stera（軽い。メニューは iPad の保存から）
 *   GET  ?part=catalog[&store=<id>] … 店のメニューまわり（iPad に保存する。version で変わったか分かる）
 *   GET  ?part=floor[&store=<id>]   … フロア（テーブル一覧）の全部（卓・伝票・予約・呼び出し・お客様情報の選択肢。2026-10-24）
 *   GET  ?part=handy                … iPhone ハンディのテーブル一覧（担当者・卓・呼び出し・フロア。Web の /handy と同じ。2026-10-24）
 *   GET  ?part=ownerHome            … iPhone オーナー・店長のホーム（売上・来店・本日の予約・30日推移。Web の /app/dashboard と同じ。2026-10-24）
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
  divide: 'pos.checkout',
  cancelLine: 'pos.order',
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

  // まだ専用の台が無かった画面（勤怠・日報…）の API（lib/native-modules/registry.ts。2026-10-24 22:05 Ronnie「全部ネイティブ」）
  const moduleGet = part ? NATIVE_MODULE_GET[part] : undefined;
  if (moduleGet) {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const r = await moduleGet({ ctx, url, store: { id: store.id, name: store.name } });
    return json(r.body, r.status ?? 200);
  }

  // 店のメニューまわり（伝票に寄らない。iPad に保存して次から先に出す。2026-10-21「メニューは超速く」）
  if (part === 'catalog') {
    const storeParam = url.searchParams.get('store');
    const storeId = isUuid(storeParam) ? storeParam : (ctx.currentStore?.id ?? ctx.stores[0]?.id ?? null);
    if (!storeId) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return json({ ok: false, error: '店舗がありません' }, 404);
    const catalog = await loadNativeCatalog(ctx, await createClient(), storeId, ctx.organizationId);
    return json({ ok: true, catalog });
  }

  // オフラインの道具箱（レジの iPad がネット無しで印字・合計するため。lib/native-offline-kit.ts。2026-10-24 Ronnie
  // 「net nachale pani print haru sabai kam」）。iPad は version が変わったときだけ入れ替えて保存する
  if (part === 'offlineKit') {
    const storeParam = url.searchParams.get('store');
    const storeId = isUuid(storeParam) ? storeParam : (ctx.currentStore?.id ?? ctx.stores[0]?.id ?? null);
    if (!storeId) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return json({ ok: false, error: '店舗がありません' }, 404);
    const kit = await loadNativeOfflineKit(await createClient(), storeId, ctx.organizationId);
    if (url.searchParams.get('have') === kit.version) return json({ ok: true, same: true, version: kit.version });
    return json({ ok: true, kit });
  }

  // ホーム（売上・達成率・来店組数・左の列のボタン）。Web のレジのホームと同じ組み立て（lib/native-home-server.ts）
  if (part === 'home') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const home = await loadNativeHome(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...home });
  }

  // iPhone ハンディのテーブル一覧。Web の /handy と同じ組み立て（lib/native-handy-server.ts。2026-10-24）
  if (part === 'handy') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: 'アクセス可能な店舗がありません', useWeb: true }, 404);
    // iPhone のハンディ端末：お店の Wi-Fi の外に3分いたらログアウト画面へ（Web の /handy の layout と同じ。Web が /handy-join に送る）
    if (ctx.isHandyDevice) {
      const { checkHandyNetwork } = await import('@/lib/handy-device-server');
      const guard = await checkHandyNetwork();
      if (guard.isDevice && guard.decision.kind === 'logout') return json({ ok: false, error: 'お店の回線の外にいます', useWeb: true }, 403);
      // 端末の鍵（コントロールセンター。自動ログアウトのあと承認し直しにならないように。migration 00104 の後・無いときだけ）
      if (guard.device) {
        const { ensureHandyDeviceToken } = await import('@/lib/handy-device-approval-server');
        await ensureHandyDeviceToken(guard.device.id);
      }
    }
    // 契約のアクセス制限（お店の回線）。引っかかったら Web の画面（案内が出る）
    const { isRequestFromStoreNetwork } = await import('@/lib/store-access-server');
    if (!(await isRequestFromStoreNetwork(store.id))) return json({ ok: false, error: ACCESS_MESSAGE.network, useWeb: true }, 403);
    const handy = await loadNativeHandy(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...handy });
  }

  // iPhone オーナー・店長のホーム。Web の /app/dashboard と同じ組み立て（lib/native-owner-home-server.ts。2026-10-24）
  if (part === 'ownerHome') {
    if (!can(ctx.role, 'dashboard.view')) return json({ ok: false, error: '権限がありません', useWeb: true }, 403);
    const home = await loadNativeOwnerHome(ctx, await createClient());
    return json({ ok: true, ...home });
  }

  // 店舗台帳（1日のスケジュール）。Web の店舗台帳と同じ組み立て（lib/native-ledger-server.ts）
  if (part === 'ledger') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const dateParam = url.searchParams.get('date');
    let date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
    const supabase = await createClient();
    // ?open=<予約> だけ来たら（設定・グルメ連携の「台帳で開く」）、その予約の日の台帳を返す
    const openId = url.searchParams.get('open');
    if (!date && openId && /^[0-9a-f-]{36}$/i.test(openId)) {
      const { data: hit } = await supabase.from('reservations').select('reserved_date').eq('id', openId).eq('store_id', store.id).maybeSingle();
      if (hit?.reserved_date) date = String(hit.reserved_date);
    }
    const ledger = await loadNativeLedger(ctx, supabase, store, date);
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

  // 設定の中の画面（品切れ・POS担当者・営業時間 …。Web の各ページと同じ読み込み。2026-10-24 Ronnie「設定の中も全部ネイティブ」）
  if (isNativeSettingsPagePart(part)) {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const page = await loadNativeSettingsPage(part, ctx, await createClient(), { id: store.id, name: store.name });
    return page.ok ? json({ ok: true, ...page.payload }) : json({ ok: false, error: page.error }, 500);
  }

  // 設定（このiPadのプリンター・レシートの出し先・LAN・Wi-Fi・設定の一覧）。Web の /app/pos/settings と同じ組み立て（lib/native-settings-server.ts）
  if (part === 'settings') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const settings = await loadNativeSettings(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...settings });
  }

  // この端末に管理画面で付けた設定（設定 › レジ端末。2026-10-24 Ronnie「管理画面から全部の設定を」）。
  // nativePos が true/false なら管理画面が決めている（アプリはそれに従い、端末の切り替えは出さない）。null は端末まかせ
  if (part === 'device') {
    const found = await currentDeviceSetting();
    if (!found) return json({ ok: true, device: null });
    return json({
      ok: true,
      device: {
        id: found.device.id,
        storeId: found.device.storeId,
        name: found.setting.label ?? found.device.name,
        printerConfigId: found.setting.printerConfigId,
        // iPad のネイティブの ON/OFF は無くなった（2026-10-25 Ronnie「Web の iPad 版はもう要らない」）。
        // 古いアプリ（1.0・1.1）は true を見て ON に固定する（端末の切り替えも出さない）
        nativePos: true,
        // LAN / Wi-Fi のプリンターは管理画面で決める（2026-10-25 Ronnie）。null は端末まかせ（今までどおり）
        lanPrinterIds: found.setting.lanPrinterIds,
        wifiPrinterIds: found.setting.wifiPrinterIds,
      },
    });
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

  // テーブルQRコード（Web の 設定 > テーブル > QR印刷。印刷物は iPad の中で描く。2026-10-24 Ronnie「QR印刷・再発行をネイティブに」）
  if (part === 'tableQr') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    return json({ ok: true, ...(await loadNativeTableQr(ctx, await createClient(), { id: store.id, name: store.name })) });
  }

  // 在庫設定（本日の残り数。Web の /app/inventory/menu-stock）
  if (part === 'stock') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const stock = await loadNativeStock(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...stock });
  }

  // 在庫（Web の /app/inventory。品目・棚卸・移動・発注提案・予測。メニュー売切は part=stock）
  if (part === 'inventory' || part === 'inventoryCount' || part === 'inventoryHistory' || part === 'inventoryPurchases') {
    if (ctx.disabledFeatures?.has('inventory')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const supabase = await createClient();
    if (part === 'inventoryCount') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: '棚卸が見つかりません' }, 404);
      const c = await loadNativeInventoryCount(ctx, supabase, id);
      if (!c) return json({ ok: false, error: '棚卸が見つかりません' }, 404);
      return json({ ok: true, ...c });
    }
    if (part === 'inventoryHistory' || part === 'inventoryPurchases') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: '品目が見つかりません' }, 404);
      if (part === 'inventoryHistory') return json({ ok: true, rows: await getMovementHistory(id) });
      return json({ ok: true, ...(await getPurchaseHistory(id)) });
    }
    const store = ctx.currentStore;
    if (!store) return json({ ok: false, error: '店舗を選択してください', useWeb: true }, 404);
    const t = url.searchParams.get('tab') ?? 'items';
    const tab: NativeInventoryTab = NATIVE_INVENTORY_TABS.includes(t as NativeInventoryTab) ? (t as NativeInventoryTab) : 'items';
    const inv = await loadNativeInventory(ctx, supabase, { id: store.id, name: store.name }, {
      tab,
      kind: (url.searchParams.get('kind') ?? '').slice(0, 20),
      q: (url.searchParams.get('q') ?? '').slice(0, 100),
      sort: url.searchParams.get('sort') ?? '',
      item: isUuid(url.searchParams.get('item')) ? (url.searchParams.get('item') as string) : '',
    });
    return json({ ok: true, ...inv });
  }

  // 着席中のお客様情報を来店登録と同じ画面で直すときの最初の値（伝票メモから。pos.order）
  if (part === 'visitEdit') {
    if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
    const orderId = url.searchParams.get('orderId');
    if (!isUuid(orderId)) return json({ ok: false, error: '注文が見つかりません' }, 404);
    const r = await loadVisitEdit(ctx, orderId);
    return json(r, r.ok ? 200 : 404);
  }

  // オーダー画面の「編集 Edit tabs」（Web のレジの MenuPagesDialog と同じ中身。menu.manage）
  if (part === 'menuPages') {
    if (!can(ctx.role, 'menu.manage')) return json({ ok: false, error: '権限がありません' }, 403);
    const storeId = url.searchParams.get('storeId');
    if (!isUuid(storeId)) return json({ ok: false, error: '店舗が見つかりません' }, 404);
    const r = await loadNativeMenuPages(storeId);
    return json(r, r.ok ? 200 : 403);
  }

  // クーポン管理（Web の /app/coupons）
  if (part === 'coupons' || part === 'couponUses') {
    if (ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'menu.manage')) return json({ ok: false, error: 'クーポン管理には権限が必要です。管理者にお問い合わせください。' }, 403);
    if (part === 'couponUses') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: 'クーポンが見つかりません' }, 404);
      return json({ ok: true, rows: await getCouponRedemptions(id) });
    }
    return json({ ok: true, ...(await loadCouponsData(await createClient(), ctx.organizationId ?? '')) });
  }

  // 仕入先・発注（Web の /app/vendors・/app/purchases）
  if (part === 'vendors' || part === 'vendorOrders' || part === 'purchases' || part === 'poNew' || part === 'po') {
    if (ctx.disabledFeatures?.has('inventory')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const supabase = await createClient();
    const org = ctx.organizationId ?? '';
    const canManage = can(ctx.role, 'vendors.manage');
    if (part === 'vendors') {
      const st = url.searchParams.get('status') ?? '';
      const rows = await loadVendorRows(supabase, org, {
        q: (url.searchParams.get('q') ?? '').slice(0, 100) || undefined,
        status: ['active', 'inactive', 'deleted'].includes(st) ? st : undefined,
      });
      return json({ ok: true, rows, canManage });
    }
    if (part === 'vendorOrders') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: '仕入先が見つかりません' }, 404);
      return json({ ok: true, rows: await getVendorRecentOrders(id) });
    }
    if (part === 'po') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: '発注書が見つかりません' }, 404);
      const po = await loadPurchaseOrderDetail(supabase, org, id);
      if (!po) return json({ ok: false, error: '発注書が見つかりません' }, 404);
      return json({ ok: true, po, canManage });
    }
    if (part === 'poNew') {
      const store = ctx.currentStore;
      if (!store) return json({ ok: false, error: '店舗を選択してください', useWeb: true }, 404);
      return json({ ok: true, store: { id: store.id, name: store.name }, ...(await loadNativePoNew(supabase, org, store.id)) });
    }
    const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
    const date = (k: string) => {
      const v = url.searchParams.get(k);
      return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    };
    const status = url.searchParams.get('status') ?? '';
    const vendor = url.searchParams.get('vendor');
    const list = await loadPurchaseOrderRows(supabase, org, storeIds, {
      status: ['draft', 'requested', 'approved', 'ordered', 'partially_received', 'received', 'cancelled'].includes(status) ? status : undefined,
      vendor: isUuid(vendor) ? (vendor as string) : undefined,
      from: date('from'),
      to: date('to'),
    });
    return json({ ok: true, ...list, canManage, canCsv: can(ctx.role, 'csv.export'), storeId: ctx.currentStore?.id ?? null });
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

  // 店舗分析（Web の /app/reports と同じ集計＝lib/reports-data-server.ts）
  if (part === 'reports') {
    if (ctx.disabledFeatures?.has('reports')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'reports.view')) return json({ ok: false, error: '権限がありません' }, 403);
    const d = (k: string) => {
      const v = url.searchParams.get(k);
      return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    };
    const store = url.searchParams.get('store');
    const data = await loadReportData(ctx, { from: d('from'), to: d('to'), store: isUuid(store) ? store : undefined });
    if (!data) return json({ ok: false, error: 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください' }, 404);
    return json({ ok: true, canExport: can(ctx.role, 'csv.export'), ...data });
  }

  // スキャン（レシート撮影。Web の /app/scan）
  if (part === 'scan') {
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'documents.write')) return json({ ok: false, error: '書類をアップロードする権限がありません。店長・経理担当者に依頼してください。' }, 403);
    const tx = url.searchParams.get('tx');
    const scan = await loadNativeScan(ctx, await createClient(), todayJst(), { type: url.searchParams.get('type') ?? '', tx: isUuid(tx) ? tx : null });
    return json({ ok: true, ...scan });
  }

  // 来店登録の「顧客名 設定」：電話番号で探す（Web の searchCustomerByPhone と同じ。2文字以上・10件まで）
  if (part === 'customerSearch') {
    if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
    const phone = (url.searchParams.get('phone') ?? '').replace(/[^0-9-]/g, '').slice(0, 20);
    return json({ ok: true, results: await searchCustomerByPhone(phone) });
  }

  // 顧客台帳（Web の /app/customers・/app/customers/[id]）
  // 顧客台帳の RFM分析・重複候補（Web の /app/customers?view=rfm|duplicates）
  if (part === 'customerRfm' || part === 'customerDuplicates') {
    if (ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'customers.view')) return json({ ok: false, error: '顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。' }, 403);
    const supabase = await createClient();
    if (part === 'customerRfm') return json({ ok: true, customers: await loadRfmCustomers(supabase, ctx.organizationId ?? '') });
    return json({ ok: true, groups: await loadDuplicateGroups(supabase, ctx.organizationId ?? ''), canMerge: can(ctx.role, 'customers.delete') });
  }

  // 重複顧客と統合：電話番号で探す（Web の searchCustomersForMerge。customers.delete）
  if (part === 'customerMergeSearch') {
    if (ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'customers.delete')) return json({ ok: false, error: '権限がありません' }, 403);
    const exclude = url.searchParams.get('exclude');
    const phone = (url.searchParams.get('phone') ?? '').slice(0, 30);
    if (!isUuid(exclude) || !phone.trim()) return json({ ok: true, results: [] });
    try {
      return json({ ok: true, results: await searchCustomersForMerge(phone, exclude) });
    } catch (e) {
      return json({ ok: false, error: errorText(e, '検索に失敗しました') }, 400);
    }
  }

  if (part === 'customers' || part === 'customer') {
    if (ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'customers.view')) return json({ ok: false, error: '顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。' }, 403);
    const supabase = await createClient();
    if (part === 'customer') {
      const id = url.searchParams.get('id');
      if (!isUuid(id)) return json({ ok: false, error: '顧客が見つかりません' }, 404);
      const c = await loadNativeCustomer(ctx, supabase, id);
      if (!c) return json({ ok: false, error: '顧客が見つかりません' }, 404);
      return json({ ok: true, ...c });
    }
    const list = await loadNativeCustomers(ctx, supabase, {
      q: (url.searchParams.get('q') ?? '').slice(0, 100),
      tag: isUuid(url.searchParams.get('tag')) ? (url.searchParams.get('tag') as string) : '',
      segment: (url.searchParams.get('segment') ?? '').slice(0, 30),
      sort: url.searchParams.get('sort') ?? '',
      page: Number(url.searchParams.get('page') ?? '1') || 1,
    });
    return json({ ok: true, ...list });
  }

  // 予算管理（Web の /app/budgets。月の売上目標・ご予約から見込む売上・店舗別の予算と実績）
  if (part === 'budgets') {
    if (!can(ctx.role, 'reports.view')) return json({ ok: false, error: '権限がありません', useWeb: true }, 403);
    const m = url.searchParams.get('month') ?? '';
    const b = await loadNativeBudgets(ctx, await createClient(), /^\d{4}-\d{2}$/.test(m) ? m : undefined);
    if (!b) return json({ ok: false, error: 'アクセス可能な店舗がありません' }, 404);
    return json({ ok: true, ...b });
  }

  // 日別予算登録（Web の /app/budgets/daily）
  if (part === 'budgetDaily' || part === 'budgetAuto') {
    if (!can(ctx.role, 'reports.view')) return json({ ok: false, error: '権限がありません', useWeb: true }, 403);
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: 'アクセス可能な店舗がありません' }, 404);
    const m = url.searchParams.get('month') ?? '';
    const month = /^\d{4}-\d{2}$/.test(m) ? m : todayJst().slice(0, 7);
    const supabase = await createClient();
    // 履歴（曜日・去年の同じ月・天気予報）から日別予算の案（lib/native-budget-server.ts。2026-10-24 Ronnie「自動予算」）
    if (part === 'budgetAuto') {
      const { data: s } = await supabase.from('stores').select('address').eq('id', store.id).maybeSingle();
      const auto = await loadNativeBudgetAuto(supabase, { id: store.id, address: (s?.address as string | null) ?? null }, month);
      return json({ ok: true, ...auto });
    }
    const daily = await loadNativeBudgetDaily(
      supabase,
      ctx.organizationId,
      { id: store.id, name: store.name },
      month,
      ['org_owner', 'hq_admin', 'area_manager', 'store_manager'].includes(ctx.role ?? '')
    );
    return json({ ok: true, ...daily });
  }

  // 予約設定＝予約受付ルール（Web の /app/settings/booking。2026-10-24）
  if (part === 'bookingSettings') {
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません', useWeb: true }, 403);
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '対象の店舗がありません' }, 404);
    const supabase = await createClient();
    const [{ data: storeRow }, { data: s }] = await Promise.all([
      supabase.from('stores').select('slug, booking_enabled').eq('id', store.id).single(),
      supabase
        .from('store_settings')
        .select('slot_minutes, default_stay_minutes, booking_cutoff_minutes, booking_window_days, max_party_size, cancel_deadline_hours, cleaning_buffer_minutes, booking_photo_url, booking_notes, cancellation_policy, reminder_enabled, reminder_hours_before')
        .eq('store_id', store.id)
        .maybeSingle(),
    ]);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (await import('@/lib/site-origin').then((m) => m.resolveSiteOrigin()));
    return json({
      ok: true,
      store: { id: store.id, name: store.name },
      // レジ端末（iPad の「<店舗名>（レジ）」）は見るだけ。変更は管理画面（2026-09-29 Ronnie「管理画面」）
      adminOnly: ctx.isRegisterDevice === true,
      adminOnlyNote: ADMIN_ONLY_SETTINGS_NOTE,
      bookingEnabled: storeRow?.booking_enabled ?? false,
      bookingUrl: storeRow?.slug ? `${siteUrl}/book/${storeRow.slug}` : null,
      settings: {
        slotMinutes: s?.slot_minutes ?? 30,
        defaultStayMinutes: s?.default_stay_minutes ?? 120,
        bookingCutoffMinutes: s?.booking_cutoff_minutes ?? 120,
        bookingWindowDays: s?.booking_window_days ?? 90,
        maxPartySize: s?.max_party_size ?? 12,
        cancelDeadlineHours: s?.cancel_deadline_hours ?? 24,
        cleaningBufferMinutes: s?.cleaning_buffer_minutes ?? 0,
        bookingPhotoUrl: s?.booking_photo_url ?? '',
        bookingNotes: s?.booking_notes ?? '',
        cancellationPolicy: s?.cancellation_policy ?? '',
        reminderEnabled: s?.reminder_enabled ?? false,
        reminderHoursBefore: s?.reminder_hours_before ?? 24,
      },
    });
  }

  // お知らせ（Web の /app/announcements）
  if (part === 'announcements') {
    if (!can(ctx.role, 'dashboard.view')) return json({ ok: false, error: '権限がありません', useWeb: true }, 403);
    return json({ ok: true, ...(await loadNativeAnnouncements(ctx, await createClient())) });
  }

  // 通知（Web の /app/notifications）
  if (part === 'notices') {
    const type = (url.searchParams.get('type') ?? '').slice(0, 60);
    const st = url.searchParams.get('store') ?? '';
    const store = ctx.stores.some((s) => s.id === st) ? st : '';
    const status = ['unread', 'read'].includes(url.searchParams.get('status') ?? '') ? (url.searchParams.get('status') as string) : '';
    return json({ ok: true, ...(await loadNativeNotices(ctx, await createClient(), { type, store, status })) });
  }

  // 小口現金・締め履歴タブ（Web の /app/cash?tab=petty / tab=closings）
  if (part === 'petty' || part === 'closings') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const dateParam = (k: string, d: string) => {
      const v = url.searchParams.get(k);
      return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d;
    };
    const from = dateParam('from', daysAgoJst(30));
    const to = dateParam('to', todayJst());
    const s = { id: store.id, name: store.name };
    if (part === 'petty') {
      const st = url.searchParams.get('status') ?? '';
      const status = ['pending', 'approved', 'rejected'].includes(st) ? st : '';
      return json({ ok: true, ...(await loadNativePetty(ctx, await createClient(), s, { from, to, status })) });
    }
    return json({ ok: true, ...(await loadNativeClosings(ctx, await createClient(), s, { from, to })) });
  }

  // 店舗台帳のグルメ連携（Web の 予約台帳設定 › グルメ連携。取り込み専用アドレス・サイトごとの状態・取り込み履歴。2026-10-24）
  if (part === 'gourmet') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    const g = await loadNativeGourmet(ctx, await createClient(), { id: store.id, name: store.name });
    return json({ ok: true, ...g });
  }

  // 予約登録に使うその日のデータ（卓・その日の予約の時間と卓・確保時間・キーワード・担当者・コースの所要時間）。
  // Web の予約登録（getReservationEntryData）と同じ。iPad で「予約可能なテーブル」を出す（2026-10-24 19:28 Ronnie）
  if (part === 'ledgerEntry') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'reservations.write')) return json({ ok: false, error: '権限がありません' }, 403);
    const date = url.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: '日付が正しくありません' }, 400);
    const entry = await loadReservationEntryData(await createClient(), store.id, date);
    return json({ ok: true, date, ...entry });
  }

  // 予約受付管理とメッセージ（店舗台帳の右上のメッセージの箱。Web の予約の画面の「受付管理｜メッセージ」と同じ。2026-10-24 19:56 Ronnie）
  if (part === 'ledgerInbox') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'reservations.view')) return json({ ok: false, error: '権限がありません' }, 403);
    const inbox = await loadReservationInbox(await createClient(), store.id, todayJst());
    return json({ ok: true, storeId: store.id, canWrite: can(ctx.role, 'reservations.write'), ...inbox });
  }

  // 店舗台帳のウェイティング（Web の view=waitlist）
  if (part === 'ledgerWait') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const wait = await loadNativeLedgerWait(await createClient(), store, url.searchParams.get('wstatus'), todayJst());
    return json({ ok: true, ...wait });
  }

  // 店舗台帳の月間カレンダー（Web の /app/reservations/calendar と同じ集計）
  if (part === 'ledgerMonth') {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const m = await loadNativeLedgerMonth(await createClient(), store, url.searchParams.get('month'), todayJst());
    return json({ ok: true, ...m });
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
    // 保存してあった一覧の店がこの人の店でなければ今の店（lib/native-floor.ts。2026-10-26「テーブルが見つかりません」）
    const store = pickNativeFloorStore(ctx, url.searchParams.get('store'));
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
  // まだ専用の台が無かった画面（勤怠・日報…）の操作（lib/native-modules/registry.ts）。店の回線の確認もここで
  const moduleType = raw && typeof raw === 'object' ? (raw as { type?: unknown }).type : null;
  const modulePost = typeof moduleType === 'string' ? NATIVE_MODULE_POST[moduleType] : undefined;
  if (modulePost) {
    const store = ctx.currentStore ?? ctx.stores[0] ?? null;
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      const r = await modulePost({ ctx, raw: raw as Record<string, unknown>, store: { id: store.id, name: store.name } });
      return json(r.body, r.status ?? 200);
    } catch (e) {
      return json({ ok: false, error: errorText(e, '保存できませんでした') }, 500);
    }
  }

  // レジの iPad がネット無しで受けた伝票を、ネットが戻ったら入れる（lib/native-offline-sync-server.ts。2026-10-24 Ronnie
  // 「net chalepaxi afai sync」）。1回＝1伝票。何度送っても二重にならない
  // 返事はいつも 200（iPad が retry を読んで、もう一度送るか人が見るかを決める）。レジの権限（pos.checkout）が要る
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'offlineSync') {
    if (!can(ctx.role, 'pos.checkout')) return json({ ok: false, error: 'レジ（会計）の権限がありません', retry: false });
    const parsedSync = parseOfflineSync(raw);
    if (!parsedSync.ok) return json({ ok: false, error: parsedSync.error, retry: false });
    const syncProblem = await networkProblem(ctx);
    if (syncProblem) return json({ ok: false, error: syncProblem, retry: true });
    try {
      return json(await syncOfflineOrder(ctx, parsedSync.order));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'オフラインの伝票を入れられませんでした'), retry: true });
    }
  }

  // iPhone ハンディ・オーナーのホームの操作（担当者・卓ロック・まとめ・呼び出し対応・店舗の切り替え。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeHandyActionType((raw as { type?: unknown }).type)) {
    const parsedHandy = parseNativeHandyAction(raw);
    if (!parsedHandy.ok) return json({ ok: false, error: parsedHandy.error }, 400);
    const ha = parsedHandy.action;
    const handyPerm: PermissionAction | null =
      ha.type === 'handyLock' || ha.type === 'handyGroup' ? 'tables.operate' : ha.type === 'switchStore' || ha.type === 'handyLogout' || ha.type === 'signOut' ? null : 'pos.order';
    if (handyPerm && !can(ctx.role, handyPerm)) return json({ ok: false, error: '権限がありません' }, 403);
    if (ha.type !== 'switchStore' && ha.type !== 'handyLogout' && ha.type !== 'signOut') {
      // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
      const handyProblem = await networkProblem(ctx);
      if (handyProblem) return json({ ok: false, error: handyProblem }, 403);
    }
    try {
      return json(await runNativeHandyAction(ha));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 店舗台帳（予約）の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeLedgerActionType((raw as { type?: unknown }).type)) {
    const parsedLedger = parseNativeLedgerAction(raw);
    if (!parsedLedger.ok) return json({ ok: false, error: parsedLedger.error }, 400);
    const action = parsedLedger.action;
    const ledgerPerm: PermissionAction =
      action.type === 'ledgerSeat' ? 'pos.order' : action.type === 'ledgerFindSeats' ? 'reservations.view' : action.type === 'ledgerTagGroupsSave' ? 'store.settings' : 'reservations.write';
    if (!can(ctx.role, ledgerPerm)) return json({ ok: false, error: '権限がありません' }, 403);
    const problem = await networkProblem(ctx);
    if (problem) return json({ ok: false, error: problem }, 403);
    try {
      return json(await runLedgerAction(ctx, action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 店舗台帳のグルメ連携の操作（オン・オフ／サイトの登録印／要確認を対応済み／アドレス作り直し。中身は Web と同じ Server Action。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeGourmetActionType((raw as { type?: unknown }).type)) {
    const parsedGourmet = parseNativeGourmetAction(raw);
    if (!parsedGourmet.ok) return json({ ok: false, error: parsedGourmet.error }, 400);
    const store = ctx.currentStore ?? ctx.stores[0];
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('reservations')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const gourmetProblem = await networkProblem(ctx);
    if (gourmetProblem) return json({ ok: false, error: gourmetProblem }, 403);
    const ga = parsedGourmet.action;
    try {
      const r =
        ga.type === 'gourmetEnable'
          ? await setGourmetMailEnabled(store.id, ga.enabled)
          : ga.type === 'gourmetMarkSite'
            ? await markGourmetSiteRegistered(store.id, ga.site, ga.registered)
            : ga.type === 'gourmetResolve'
              ? await resolveGourmetMailImport(store.id, ga.importId)
              : await regenerateGourmetMailToken(store.id);
      return json(r.error ? { ok: false, error: r.error } : { ok: true });
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

  // 在庫の操作（品目・入出庫・棚卸・店舗間移動。中身は Web と同じ Server Action。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeInventoryActionType((raw as { type?: unknown }).type)) {
    const parsedInv = parseNativeInventoryAction(raw);
    if (!parsedInv.ok) return json({ ok: false, error: parsedInv.error }, 400);
    if (ctx.disabledFeatures?.has('inventory')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const ia = parsedInv.action;
    if (!can(ctx.role, nativeInventoryPermission(ia.type))) return json({ ok: false, error: 'この操作を行う権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const invProblem = await networkProblem(ctx);
    if (invProblem) return json({ ok: false, error: invProblem }, 403);
    const store = ctx.currentStore;
    try {
      switch (ia.type) {
        case 'invItemCreate': {
          if (!store) return json({ ok: false, error: '店舗を選択してください' }, 400);
          const { type: _t, ...input } = ia;
          void _t;
          await createItem({ storeId: store.id, ...input });
          return json({ ok: true });
        }
        case 'invItemUpdate': {
          const { type: _t, id, ...input } = ia;
          void _t;
          await updateItem(id, input);
          return json({ ok: true });
        }
        case 'invMovement':
          await addMovement({ itemId: ia.itemId, movementType: ia.movementType, quantity: ia.quantity, reason: ia.reason, unitCost: ia.unitCost });
          return json({ ok: true });
        case 'invCountStart': {
          if (!store) return json({ ok: false, error: '店舗を選択してください' }, 400);
          const id = await startCount(store.id);
          return json({ ok: true, id });
        }
        case 'invCountSave':
          await saveCounts(ia.countId, ia.entries);
          if (ia.finalize) await finalizeCount(ia.countId);
          return json({ ok: true });
        case 'invTransferDirect':
          await transferStock({ fromItemId: ia.fromItemId, toStoreId: ia.toStoreId, quantity: ia.quantity, reason: ia.reason });
          return json({ ok: true });
        case 'invTransferRequest': {
          if (!store) return json({ ok: false, error: '店舗を選択してください' }, 400);
          const id = await requestStockTransfer({ fromStoreId: store.id, toStoreId: ia.toStoreId, note: ia.note, lines: ia.lines });
          return json({ ok: true, id });
        }
        case 'invTransferShip':
          await shipStockTransfer(ia.id);
          return json({ ok: true });
        case 'invTransferReceive':
          await receiveStockTransfer(ia.id);
          return json({ ok: true });
        case 'invTransferCancel':
          await cancelStockTransfer(ia.id, ia.reason);
          return json({ ok: true });
      }
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 着席中のお客様情報の保存（来店登録と同じ画面。中身は Web と同じ setSeatTime ほか。pos.order → 店の回線）
  if (raw && typeof raw === 'object' && isNativeVisitEditType((raw as { type?: unknown }).type)) {
    const parsedVisit = parseNativeVisitEdit(raw);
    if (!parsedVisit.ok) return json({ ok: false, error: parsedVisit.error }, 400);
    if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
    const visitProblem = await networkProblem(ctx);
    if (visitProblem) return json({ ok: false, error: visitProblem }, 403);
    try {
      return json(await saveVisitEdit(ctx, parsedVisit.action));
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 上のタブ（ページ）の保存（中身は Web と同じ saveMenuBookPages。menu.manage → 店の回線）
  if (raw && typeof raw === 'object' && isNativeMenuPagesActionType((raw as { type?: unknown }).type)) {
    const parsedPages = parseNativeMenuPagesAction(raw);
    if (!parsedPages.ok) return json({ ok: false, error: parsedPages.error }, 400);
    if (!can(ctx.role, 'menu.manage')) return json({ ok: false, error: '権限がありません' }, 403);
    const pagesProblem = await networkProblem(ctx);
    if (pagesProblem) return json({ ok: false, error: pagesProblem }, 403);
    const pa = parsedPages.action;
    try {
      const r = await saveMenuBookPages(pa.storeId, { pages: pa.pages, categoryPage: pa.categoryPage });
      return json(r.error ? { ok: false, error: r.error } : { ok: true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // クーポンの操作（中身は Web と同じ Server Action。menu.manage → 店の回線。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeCouponActionType((raw as { type?: unknown }).type)) {
    const parsedCoupon = parseNativeCouponAction(raw);
    if (!parsedCoupon.ok) return json({ ok: false, error: parsedCoupon.error }, 400);
    if (ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'menu.manage')) return json({ ok: false, error: '権限がありません' }, 403);
    const couponProblem = await networkProblem(ctx);
    if (couponProblem) return json({ ok: false, error: couponProblem }, 403);
    const ca = parsedCoupon.action;
    try {
      if (ca.type === 'couponCode') return json({ ok: true, id: await generateCouponCode() });
      const r = ca.type === 'couponSave' ? await saveCoupon(ca.input) : await setCouponStatus(ca.id, ca.status);
      return json(r.error ? { ok: false, error: r.error } : { ok: true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 仕入先・発注の操作（中身は Web と同じ Server Action。どれも vendors.manage。2026-10-24）
  if (raw && typeof raw === 'object' && isNativePurchasingActionType((raw as { type?: unknown }).type)) {
    const parsedPur = parseNativePurchasingAction(raw);
    if (!parsedPur.ok) return json({ ok: false, error: parsedPur.error }, 400);
    if (ctx.disabledFeatures?.has('inventory')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'vendors.manage')) return json({ ok: false, error: 'この操作を行う権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const purProblem = await networkProblem(ctx);
    if (purProblem) return json({ ok: false, error: purProblem }, 403);
    const pa = parsedPur.action;
    try {
      switch (pa.type) {
        case 'vendorSave':
          if (pa.id) await updateVendor(pa.id, pa.input);
          else await createVendor(pa.input);
          return json({ ok: true });
        case 'vendorDelete':
          await deleteVendor(pa.id, pa.reason);
          return json({ ok: true });
        case 'poCreate': {
          const store = ctx.currentStore;
          if (!store) return json({ ok: false, error: '店舗を選択してください' }, 400);
          const id = await createPurchaseOrder({ storeId: store.id, vendorId: pa.vendorId, expectedAt: pa.expectedAt, note: pa.note, lines: pa.lines });
          return json({ ok: true, id });
        }
        case 'poStatus':
          await changePurchaseOrderStatus(pa.id, pa.action);
          return json({ ok: true });
        case 'poCancel':
          await cancelPurchaseOrder(pa.id, pa.reason);
          return json({ ok: true });
        case 'poReceive':
          await receiveItems(pa.id, pa.receipts);
          return json({ ok: true });
      }
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // スキャンの保存（写真を本文で受け取り、Web と同じ場所へ上げて同じ Server Action で登録。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeScanActionType((raw as { type?: unknown }).type)) {
    const parsedScan = parseNativeScanAction(raw);
    if (!parsedScan.ok) return json({ ok: false, error: parsedScan.error }, 400);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, 'documents.write')) return json({ ok: false, error: '書類をアップロードする権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const scanProblem = await networkProblem(ctx);
    if (scanProblem) return json({ ok: false, error: scanProblem }, 403);
    const sa = parsedScan.action;
    const supabase = await createClient();
    // 紐付ける出金があればその店、無ければ今の店（Web の ScanCapture の storeId と同じ）
    let storeId: string | null = ctx.currentStore?.id ?? null;
    if (sa.txId) {
      const { data: t } = await supabase.from('cash_transactions').select('store_id').eq('id', sa.txId).eq('organization_id', ctx.organizationId).maybeSingle();
      if (t && ctx.stores.some((s) => s.id === t.store_id)) storeId = t.store_id as string;
    }
    const bytes = Buffer.from(sa.dataBase64, 'base64');
    if (bytes.length === 0) return json({ ok: false, error: '写真が正しくありません' }, 400);
    // ScanSnap のまとめて取り込み（dayFolder）はその日のフォルダ（…/年/月/日/。Web の ScanBulkImport と同じ）。撮影は …/年/月/
    const path = sa.dayFolder
      ? nativeScanDayPath(ctx.organizationId, storeId, sa.mimeType, crypto.randomUUID(), todayJst())
      : nativeScanPath(ctx.organizationId, storeId, sa.mimeType, crypto.randomUUID());
    const { error: upErr } = await supabase.storage.from('documents').upload(path, bytes, { contentType: sa.mimeType, upsert: false });
    if (upErr) return json({ ok: false, error: 'ストレージへのアップロードに失敗しました' });
    try {
      const { id } = await createScanDocument({ filePath: path, fileName: sa.fileName, mimeType: sa.mimeType, sizeBytes: bytes.length, storeId, contentHash: sa.contentHash });
      if (sa.txId && can(ctx.role, 'cash.write')) {
        try {
          await attachReceiptToCashTransaction(sa.txId, id);
          return json({ ok: true, orderId: id, queued: 1 });
        } catch (e) {
          return json({ ok: false, error: `書類は保存しましたが、出金への紐付けに失敗しました：${errorText(e, '不明なエラー')}` });
        }
      }
      // documentId はまとめて取り込み（NativeScanBulkView）が読む。orderId は撮影の画面の今までの名前
      return json({ ok: true, orderId: id, documentId: id, queued: 0 });
    } catch (e) {
      return json({ ok: false, error: errorText(e, '登録に失敗しました') }, 400);
    }
  }

  // 顧客台帳の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeCustomerActionType((raw as { type?: unknown }).type)) {
    const parsedCustomer = parseNativeCustomerAction(raw);
    if (!parsedCustomer.ok) return json({ ok: false, error: parsedCustomer.error }, 400);
    const forOrder = parsedCustomer.action.type === 'orderCustomer';
    if (!forOrder && ctx.disabledFeatures?.has('crm')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    if (!can(ctx.role, nativeCustomerPermission(parsedCustomer.action.type))) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const customerProblem = await networkProblem(ctx);
    if (customerProblem) return json({ ok: false, error: customerProblem }, 403);
    const ca = parsedCustomer.action;
    try {
      if (ca.type === 'customerCreate') {
        const { type: _t, ...input } = ca;
        void _t;
        const r = await createCustomer(input);
        return json({ ok: true, orderId: r.id });
      }
      if (ca.type === 'orderCustomer') {
        await setOrderCustomer(ca.orderId, ca.customerId);
        return json({ ok: true });
      }
      switch (ca.type) {
        case 'customerAttributes': {
          const { type: _t, id, ...input } = ca;
          void _t;
          await updateCustomerAttributes(id, input);
          break;
        }
        case 'customerNote':
          await addCustomerNote(ca.id, ca.body);
          break;
        case 'customerRecalc':
          await recalcCustomerStats(ca.id);
          break;
        case 'customerBasic': {
          const { type: _t, id, ...input } = ca;
          void _t;
          await updateCustomerBasic(id, input);
          break;
        }
        case 'customerConsent':
          await updateCustomerConsent(ca.id, ca.consentType, ca.granted);
          break;
        case 'customerTagAttach':
          await attachCustomerTag(ca.id, ca.tagId);
          break;
        case 'customerTagDetach':
          await detachCustomerTag(ca.id, ca.tagId);
          break;
        case 'customerTagCreate': {
          const { id: tagId } = await createCustomerTag(ca.name, ca.color);
          await attachCustomerTag(ca.id, tagId);
          break;
        }
        case 'customerMemberNo':
          await updateCustomerMemberNo(ca.id, ca.memberNo);
          break;
        case 'customerMemberRank':
          await updateCustomerMemberRank(ca.id, ca.rank);
          break;
        case 'customerPoints':
          await adjustCustomerPoints(ca.id, ca.delta, ca.reason);
          break;
        case 'customerMerge':
          await mergeCustomers(ca.id, ca.mergeIds);
          break;
        case 'customerAnonymize':
          await anonymizeCustomer(ca.id, ca.reason);
          break;
        case 'customerDelete':
          await deleteCustomer(ca.id, ca.reason);
          break;
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 日別予算の保存（2026-10-24）
  if (raw && typeof raw === 'object' && isNativeBudgetActionType((raw as { type?: unknown }).type)) {
    const parsedBudget = parseNativeBudgetAction(raw);
    if (!parsedBudget.ok) return json({ ok: false, error: parsedBudget.error }, 400);
    const store = ctx.currentStore ?? ctx.stores[0];
    if (!store) return json({ ok: false, error: 'アクセス可能な店舗がありません' }, 404);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const budgetProblem = await networkProblem(ctx);
    if (budgetProblem) return json({ ok: false, error: budgetProblem }, 403);
    try {
      const ba = parsedBudget.action;
      if (ba.type === 'budgetTargetSave') {
        const r = await saveMonthlySalesTarget({ storeId: ba.storeId, month: ba.month, amount: ba.amount });
        return json(r.error ? { ok: false, error: r.error } : { ok: true, queued: r.dailyDistributed ? 1 : 0 });
      }
      if (ba.type === 'budgetUpsert') {
        const { type: _t, ...input } = ba;
        void _t;
        await upsertBudget(input);
        return json({ ok: true });
      }
      const r = await saveDailyBudgets(store.id, ba.month, ba.values);
      return json(r.error ? { ok: false, error: r.error } : { ok: true, queued: r.total ?? 0 });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 設定の中の画面の操作（品切れ・POS担当者・営業時間 …。中身は Web と同じ Server Action。権限はその中で見る。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeSettingsPageActionType((raw as { type?: unknown }).type)) {
    const parsedPage = parseNativeSettingsPageAction(raw);
    if (!parsedPage.ok) return json({ ok: false, error: parsedPage.error }, 400);
    const pageStore = ctx.currentStore ?? ctx.stores[0];
    if (!pageStore) return json({ ok: false, error: '店舗がありません' }, 404);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const pageProblem = await networkProblem(ctx);
    if (pageProblem) return json({ ok: false, error: pageProblem }, 403);
    try {
      const r = await runNativeSettingsPageAction(parsedPage.action, { id: pageStore.id, name: pageStore.name });
      return r.ok ? json({ ok: true, ...(r.data ?? {}) }) : json({ ok: false, error: r.error }, 400);
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 設定：このiPadのプリンター（Web の app/app/pos/device-printer-actions.ts と同じ Server Action。権限はその中で見る。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeSettingsActionType((raw as { type?: unknown }).type)) {
    const parsedSettings = parseNativeSettingsAction(raw);
    if (!parsedSettings.ok) return json({ ok: false, error: parsedSettings.error }, 400);
    const sa = parsedSettings.action;
    try {
      if (sa.type === 'settingsPrinterSelect') {
        const res = await setDevicePrinter(sa.printerId);
        return res.ok ? json({ ok: true, selectedPrinterId: sa.printerId }) : json({ ok: false, error: res.error }, 400);
      }
      if (sa.type === 'settingsPrinterAdd') {
        const res = await addDeviceReceiptPrinter({
          printerId: sa.printerId,
          name: sa.name,
          maker: sa.maker,
          via: sa.via,
          modelId: sa.modelId,
          paperWidthMm: sa.paperWidthMm,
          autoPrint: sa.autoPrint,
          drawerKick: sa.drawerKick,
        });
        return res.ok ? json({ ok: true, printer: res.printer }) : json({ ok: false, error: res.error }, 400);
      }
      const res = await saveDeviceReceiptPrinterSettings({
        printerId: sa.printerId,
        modelId: sa.modelId,
        paperWidthMm: sa.paperWidthMm,
        autoPrint: sa.autoPrint,
        drawerKick: sa.drawerKick,
      });
      return res.ok ? json({ ok: true, printer: res.printer }) : json({ ok: false, error: res.error }, 400);
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 予約設定の保存・店舗写真の取り込み（2026-10-24）。中身は Web と同じ Server Action（レジ端末は中で「管理画面で変更してください」）
  if (raw && typeof raw === 'object' && isNativeBookingActionType((raw as { type?: unknown }).type)) {
    const parsedBooking = parseNativeBookingAction(raw);
    if (!parsedBooking.ok) return json({ ok: false, error: parsedBooking.error }, 400);
    const store = ctx.currentStore ?? ctx.stores[0];
    if (!store) return json({ ok: false, error: '対象の店舗がありません' }, 404);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const bookingProblem = await networkProblem(ctx);
    if (bookingProblem) return json({ ok: false, error: bookingProblem }, 403);
    try {
      const ba = parsedBooking.action;
      if (ba.type === 'bookingPhotoImport') {
        const r = await importStorePhotoFromPage({ storeId: store.id, pageUrl: ba.pageUrl });
        return json(r.error ? { ok: false, error: r.error } : { ok: true, photoUrl: r.photoUrl ?? null });
      }
      const r = await updateBookingSettings({
        storeId: store.id,
        slotMinutes: ba.slotMinutes,
        defaultStayMinutes: ba.defaultStayMinutes,
        bookingCutoffMinutes: ba.bookingCutoffMinutes,
        bookingWindowDays: ba.bookingWindowDays,
        maxPartySize: ba.maxPartySize,
        cancelDeadlineHours: ba.cancelDeadlineHours,
        cleaningBufferMinutes: ba.cleaningBufferMinutes,
        bookingPhotoUrl: ba.bookingPhotoUrl,
        bookingNotes: ba.bookingNotes,
        cancellationPolicy: ba.cancellationPolicy,
        reminderEnabled: ba.reminderEnabled,
        reminderHoursBefore: ba.reminderHoursBefore,
      });
      return json(r.error ? { ok: false, error: r.error } : { ok: true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 通知の既読（自分宛だけ。回線は見ない＝Web と同じく requireSession だけ）
  if (raw && typeof raw === 'object' && isNativeNoticeActionType((raw as { type?: unknown }).type)) {
    const parsedNotice = parseNativeNoticeAction(raw);
    if (!parsedNotice.ok) return json({ ok: false, error: parsedNotice.error }, 400);
    const na = parsedNotice.action;
    if (na.type === 'annCreate' || na.type === 'annDelete') {
      if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
      // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
      const annProblem = await networkProblem(ctx);
      if (annProblem) return json({ ok: false, error: annProblem }, 403);
    }
    try {
      if (na.type === 'noticeRead') await markNotificationRead(na.id);
      else if (na.type === 'noticeReadAll') await markAllRead();
      else if (na.type === 'annRead') await markAnnouncementRead(na.id);
      else if (na.type === 'annDelete') await deleteAnnouncement(na.id);
      else {
        const target = ctx.currentStore ?? ctx.stores[0];
        if (!na.allStores && !target) return json({ ok: false, error: '店舗がありません' }, 404);
        await createAnnouncement({ title: na.title, body: na.body, isImportant: na.isImportant, publishFrom: na.publishFrom, publishTo: na.publishTo, storeId: na.allStores ? null : target!.id });
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // テーブルQRの再発行・停止（中身は Web の 設定 > テーブル の「QRコード」と同じ Server Action。2026-10-24）
  if (raw && typeof raw === 'object' && isNativeTableQrActionType((raw as { type?: unknown }).type)) {
    const parsedQr = parseNativeTableQrAction(raw);
    if (!parsedQr.ok) return json({ ok: false, error: parsedQr.error }, 400);
    if (!can(ctx.role, 'store.settings')) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const qrProblem = await networkProblem(ctx);
    if (qrProblem) return json({ ok: false, error: qrProblem }, 403);
    try {
      // レジ端末のアカウントからは Web と同じく不可（ADMIN_ONLY_SETTINGS_NOTE が error で返る）
      const r =
        parsedQr.action.type === 'tableQrRegenerate'
          ? await regenerateTableQrToken(parsedQr.action.tableId)
          : await invalidateTableQrToken(parsedQr.action.tableId);
      if (r.error) return json({ ok: false, error: r.error }, 400);
      return json({ ok: true, url: r.url ?? null, invalidated: r.invalidated === true });
    } catch (e) {
      return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
    }
  }

  // 小口現金・締め履歴の操作（2026-10-24）
  if (raw && typeof raw === 'object' && isNativePettyActionType((raw as { type?: unknown }).type)) {
    const parsedPetty = parseNativePettyAction(raw);
    if (!parsedPetty.ok) return json({ ok: false, error: parsedPetty.error }, 400);
    const a = parsedPetty.action;
    const store = ctx.currentStore ?? ctx.stores[0];
    if (!store) return json({ ok: false, error: '店舗がありません' }, 404);
    if (ctx.disabledFeatures?.has('accounting')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);
    const perm = nativePettyPermission(a.type);
    if (perm && !can(ctx.role, perm)) return json({ ok: false, error: '権限がありません' }, 403);
    // Route Handler では requirePermission がお店の回線を見ないので、ここで見る（ほかの操作と同じ）
    const pettyProblem = await networkProblem(ctx);
    if (pettyProblem) return json({ ok: false, error: pettyProblem }, 403);
    try {
      switch (a.type) {
        case 'pettyAdd':
          await addPettyCash({ storeId: store.id, kind: a.kind, amount: a.amount, purpose: a.purpose, expenseAccountId: a.expenseAccountId });
          break;
        case 'pettyApprove':
          await approvePettyCash(a.id);
          break;
        case 'pettyReject':
          await rejectPettyCash(a.id, a.reason);
          break;
        case 'pettyOpening':
          await updatePettyOpeningBalance(store.id, a.amount);
          break;
        case 'pettyCount':
          await recordPettyCashCount({ storeId: store.id, countDate: a.countDate, expectedAmount: a.expectedAmount, countedAmount: a.countedAmount, note: a.note });
          break;
        case 'pettyCountApprove':
          await approvePettyCashCount(a.id);
          break;
        case 'closingApprove':
          await approveClosing(a.id);
          break;
        case 'closingReopen':
          await reopenClosing(a.id, a.reason);
          break;
        case 'closingReopenStoreDay': {
          const r = await reopenStoreDay(a.storeId, a.businessDate, a.reason);
          if (!r.ok) return json({ ok: false, error: r.error });
          break;
        }
      }
      return json({ ok: true });
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
          if (isNativeCustomLine(l)) {
            // 「その他（金額入力）」は Web の Other ボタンと同じ addCustomPriceItem
            await addCustomPriceItem(action.orderId, { ...l.custom, quantity: l.quantity });
            continue;
          }
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
      case 'divide':
        // 別々会計の「分ける」：1つの品を n 人分の「品名（1/n）」に（Web の伝票分割と同じ Server Action）
        await divideOrderItem(action.orderId, action.lineId, action.parts);
        return json({ ok: true, order: await freshOrder(action.orderId) });
      case 'cancelLine': {
        // 1品の取消。レジは店長以上の担当者の承認（approvedByClerkId）をサーバーで確かめる（Web のレジと同じ）。
        // 送った品ならレジに「取消」の紙（cancelItem の中）、厨房の取消伝票は iPad から LAN で直接出す分をここで渡す
        await cancelItem(action.orderId, action.lineId, action.reason, action.approvedByClerkId);
        const prints = await lanKitchenPrintsForOrder(action.orderId);
        return json({ ok: true, order: await freshOrder(action.orderId), prints });
      }
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
        // iPad が Bluetooth・USB でつないでいるレシートプリンターにドロアがつながっていれば、キューに積まずにその場で開く（receipt を返す）
        if (action.bluetoothLink) {
          const direct = await directDrawerBytes(supabase, order.store_id as string, action.bluetoothLink).catch(() => null);
          if (direct) return json({ ok: true, opened: true, receipt: direct });
        }
        const res = await enqueueDrawerKick(order.store_id as string);
        return json({ ok: true, opened: res.ok, error: res.ok ? undefined : res.error });
      }
    }
  } catch (e) {
    return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') }, 400);
  }
}

/** フロアの操作。中身は Web のテーブル一覧のポップアップと同じ Server Action */
/**
 * 伝票の店の厨房伝票のうち、iPad から LAN で直接出す分（取消のマイナス差分も入る。claim_kitchen_items）。
 * 注文確定と同じしくみ。読めなくても取消は成り立たせる（空の配列）
 */
async function lanKitchenPrintsForOrder(orderId: string): Promise<NativePrintJob[]> {
  try {
    const admin = createAdminClient();
    const { data: row } = await admin.from('orders').select('store_id').eq('id', orderId).maybeSingle();
    return row?.store_id ? await claimLanKitchenPrints(admin, row.store_id as string) : [];
  } catch (e) {
    console.error('[native.cancel] kitchen LAN prints failed:', e);
    return [];
  }
}

async function runFloorAction(action: NativeFloorAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'floorStart': {
      // プラン商品は「未送信」で伝票へ（レジのファーストオーダーと同じ。厨房へは注文画面の注文確定で）
      // 来店経路はここでは選ばなくてよい（予約の卓は予約の経路、ほかは会計で選ぶ。2026-10-24 Ronnie）
      const res = await startRegisterVisit(action.tableId, action.draft, { sourceOptional: true });
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
      // テーブルクリア：1品ずつ取消（レジの「取消」の紙は cancelItem の中）。厨房の取消伝票は iPad から LAN で直接出す分を渡す
      const res = await clearTable(action.orderId, action.reason, action.approvedByClerkId);
      const prints = await lanKitchenPrintsForOrder(action.orderId);
      return { ok: true, cancelledItems: res.cancelledItems, prints };
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
    // receipt＝iPad がそのまま Bluetooth・USB で出す紙（会計の checkout と同じ形。返したときはキューに積んでいない）
    case 'cashClose': {
      const counted = sumNativeDenominations(action.denominations);
      const r = await closeRegister(action.sessionId, counted, action.reason, action.denominations, action.clerkName, action.bluetoothLink ?? null);
      return r.ok
        ? { ok: true, printWarning: r.printWarning ?? null, signOutAfter: r.signOutAfter === true, ...(r.receipt ? { receipt: r.receipt } : {}) }
        : { ok: false, error: r.error };
    }
    case 'cashReprint': {
      const r = await reprintRegisterReport(action.sessionId, action.bluetoothLink ?? null);
      return r.ok ? { ok: true, ...(r.receipt ? { receipt: r.receipt } : {}) } : { ok: false, error: r.error };
    }
    case 'cashSettlement': {
      const r = await printSettlementReport(action.sessionId, action.bluetoothLink ?? null);
      return r.ok ? { ok: true, ...(r.receipt ? { receipt: r.receipt } : {}) } : { ok: false, error: r.error };
    }
    case 'periodReport': {
      const r = await printPeriodReport(action.from, action.to, action.clerkName, action.bluetoothLink ?? null);
      return r.ok ? { ok: true, ...(r.receipt ? { receipt: r.receipt } : {}) } : { ok: false, error: r.error };
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
        email: i.email || undefined,
        tags: i.tags,
        partySizeMin: i.partySizeMin,
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
    case 'ledgerInboxAct': {
      if (action.act === 'confirm') await confirmPendingReservation(action.id);
      else if (action.act === 'contacted') await markReservationContacted(action.id);
      else if (action.act === 'ack') await acknowledgeReservation(action.id);
      else await resolveInboxImport(action.id);
      return { ok: true };
    }
    case 'ledgerKeywordsSave': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const r = await saveReservationKeywords(store.id, action.keywords);
      return r.error ? { ok: false, error: r.error } : { ok: true, keywords: r.keywords };
    }
    case 'ledgerTagGroupsSave': {
      const store = ctx.currentStore ?? ctx.stores[0];
      if (!store) return { ok: false, error: '店舗がありません' };
      const r = await saveReservationTagGroups(store.id, action.groups);
      return r.error ? { ok: false, error: r.error } : { ok: true, tagGroups: r.groups };
    }
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
