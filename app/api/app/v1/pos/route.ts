import { NextResponse } from 'next/server';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { can, type PermissionAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { isUuid, NATIVE_APP_HEADER, parseNativePosAction, type NativePosAction } from '@/lib/native-pos';
import { loadNativeCatalog, loadNativeLive, loadNativeOrder, loadNativePos, setOrderVisitSource } from '@/lib/native-pos-server';
import { claimLanKitchenPrints, finishLanPrint } from '@/lib/native-print-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { checkout, splitOrder, sendOrderToKitchen, setDiscount, updateQty, addItem } from '@/app/app/pos/actions';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { cancelSteraPayment, checkSteraPayment, startSteraPayment } from '@/app/app/pos/stera-actions';
import { enqueueDrawerKick, enqueueExpoSlipPrint, enqueueOrderSlipPrint, enqueueReceiptPrint, enqueueSelectedItemsPrint } from '@/app/app/pos/print-actions';
import { shouldOpenDrawer } from '@/lib/printing/types';
import { isNativeFloorActionType, parseNativeFloorAction, type NativeFloorAction } from '@/lib/native-floor';
import { loadNativeFloor } from '@/lib/native-floor-server';
import { clearTable, mergeOrders, setGuestCount, setPaymentMemo, setSeatTime } from '@/app/app/pos/actions';
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
  }
}
