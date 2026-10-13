import { NextResponse } from 'next/server';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { can, type PermissionAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { isUuid, NATIVE_APP_HEADER, parseNativePosAction, type NativePosAction } from '@/lib/native-pos';
import { loadNativeOrder, loadNativePos, setOrderVisitSource } from '@/lib/native-pos-server';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { checkout, sendOrderToKitchen, setDiscount, updateQty, addItem } from '@/app/app/pos/actions';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { cancelSteraPayment, checkSteraPayment, startSteraPayment } from '@/app/app/pos/stera-actions';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';
import { shouldOpenDrawer } from '@/lib/printing/types';

/**
 * iPad アプリのネイティブ画面（オーダー・会計）用の入口（2026-10-13 Ronnie「Airレジのようにネイティブで」）。
 *   GET  ?order=<id>          … 画面を開くときの全部（メニュー・伝票・担当者・会計の選択肢・stera）
 *   GET  ?order=<id>&part=order … 伝票だけ（読み直し）
 *   POST { type, … }          … 注文確定（明細を入れて厨房へ）・数量・担当者・値引き・来店経路・会計・stera
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

const PERMISSION: Record<NativePosAction['type'], PermissionAction> = {
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
};

export async function GET(request: Request) {
  if (!fromApp(request)) return json({ ok: false, error: 'アプリから開いてください' }, 400);
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId || !ctx.role) return json({ ok: false, error: 'ログインしてください' }, 401);
  if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
  if (ctx.disabledFeatures?.has('pos')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);

  const url = new URL(request.url);
  const orderId = url.searchParams.get('order');
  if (!isUuid(orderId)) return json({ ok: false, error: '伝票が正しくありません' }, 400);

  if (url.searchParams.get('part') === 'order') {
    const order = await loadNativeOrder(await createClient(), ctx, orderId);
    if (!order) return json({ ok: false, error: '注文が見つかりません' }, 404);
    return json({ ok: true, order });
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
          await addItem(action.orderId, l.menuItemId, l.optionItemIds, l.quantity, null);
        }
        const res = await sendOrderToKitchen(action.orderId);
        return json({ ok: true, printWarning: res.printWarning ?? null, order: await freshOrder(action.orderId) });
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
        const outcome = await checkout(action.orderId, action.payments, action.memo || undefined);
        if (outcome.registerClosed) {
          return json(
            { ok: false, registerClosed: true, error: 'レジが未開局のため会計できません。「レジクローズ」画面で釣銭準備金を数えてレジを開局してください' },
            409
          );
        }
        return json({ ok: true, alreadyPaid: !!outcome.alreadyPaid, warning: outcome.warning ?? null, pointsEarned: outcome.pointsEarned ?? 0 });
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
