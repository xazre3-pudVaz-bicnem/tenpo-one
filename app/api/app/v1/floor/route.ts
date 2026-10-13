import { NextResponse } from 'next/server';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { can, type PermissionAction } from '@/lib/permissions';
import { NATIVE_APP_HEADER } from '@/lib/native-pos';
import { parseNativeFloorAction, type NativeFloorAction } from '@/lib/native-floor';
import { loadNativeFloor } from '@/lib/native-floor-server';
import { ACCESS_MESSAGE } from '@/lib/store-access';
import { completeCleaning, goToOrder, startWalkIn } from '@/app/app/floor/actions';

/**
 * iPad アプリのネイティブの「テーブル一覧」用の入口（2026-10-13 Ronnie「iPad がアプリらしくない。テーブルの画面も」）。
 *   GET              … フロア・卓（状態・伝票・これからの予約・呼び出し）・今日の予約
 *   POST { type, … } … walkIn（空席に着席 → 伝票）・openOrder（着席中の卓の伝票）・cleaningDone（清掃完了）
 * 中身は Web のフロア（app/app/floor/actions.ts）と同じ処理。Web の画面は変えない。
 * アプリは必ず `x-tenpo-app: 1` を付ける。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

function fromApp(request: Request): boolean {
  return request.headers.get(NATIVE_APP_HEADER) === '1';
}

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw)) return fallback;
  return raw;
}

/** Server Action と同じ回線の制限（/api/app/v1/pos と同じ） */
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

const PERMISSION: Record<NativeFloorAction['type'], PermissionAction> = {
  walkIn: 'tables.operate',
  openOrder: 'pos.order',
  cleaningDone: 'tables.operate',
};

export async function GET(request: Request) {
  if (!fromApp(request)) return json({ ok: false, error: 'アプリから開いてください' }, 400);
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId || !ctx.role) return json({ ok: false, error: 'ログインしてください' }, 401);
  if (!can(ctx.role, 'pos.order')) return json({ ok: false, error: '権限がありません' }, 403);
  if (ctx.disabledFeatures?.has('pos')) return json({ ok: false, error: 'この機能は使えません', useWeb: true }, 403);

  // お店の回線（Web のフロアと同じ。フロアはレジ端末の台数を数えない）。引っかかったら Web の画面で開いてもらう
  const store = ctx.currentStore ?? ctx.stores[0];
  if (store) {
    const { loadStoreAccess } = await import('@/lib/store-access-server');
    const { onNetwork } = await loadStoreAccess(store.id);
    if (!onNetwork) return json({ ok: false, error: ACCESS_MESSAGE.network, useWeb: true }, 403);
  }

  const result = await loadNativeFloor(ctx);
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
  const parsed = parseNativeFloorAction(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const action = parsed.action;
  if (!can(ctx.role, PERMISSION[action.type])) return json({ ok: false, error: '権限がありません' }, 403);
  const problem = await networkProblem(ctx);
  if (problem) return json({ ok: false, error: problem }, 403);

  try {
    switch (action.type) {
      case 'walkIn': {
        const res = await startWalkIn(action.tableId, action.partySize);
        return json({ ok: true, orderId: res.orderId });
      }
      case 'openOrder': {
        const res = await goToOrder(action.tableId);
        return json({ ok: true, orderId: res.orderId });
      }
      case 'cleaningDone':
        await completeCleaning(action.tableId);
        return json({ ok: true });
    }
  } catch (e) {
    return json({ ok: false, error: errorText(e, '操作できませんでした。もう一度お試しください') }, 400);
  }
}
