import { NATIVE_APP_HEADER } from '@/lib/native-pos';
import { parseDisplayAppAction } from '@/lib/display-monitor';
import { displayHeartbeatServer } from '@/lib/display-monitor-server';
import { advanceDisplayItem, leaveDisplayDevice, loadDisplayScreenForApp, markDisplayOrderServed, pairDisplayDeviceWithCode } from '@/lib/display-ops-server';

/**
 * iPad アプリをディスプレイ端末（キッチンディスプレイ・呼び出しモニター）として使うときの API（2026-10-25 Ronnie「101% native」）。
 * Web の /display・/display-pair と同じ判定・同じ中身（lib/display-monitor-server.ts・lib/display-ops-server.ts）を JSON で返す。
 * レジの API（/api/app/v1/pos）はディスプレイ端末のアカウントでは使えない（lib/auth.ts で役割なし）ため、ここだけを使う。
 *
 * GET  → 今出す画面（案内／キッチン／呼び出し）と中身。セッションが切れていれば端末の鍵でつなぎ直す
 * POST → { type: 'pair', code } 登録（未ログインから）／ 'advance' 'served' キッチンの操作 ／ 'heartbeat' 見守り ／ 'leave' レジに戻す
 */

const noStore = { 'cache-control': 'no-store' };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/** 現場で分かる言葉にする（Next の内部の文は出さない） */
function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (!raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw)) return fallback;
  return raw;
}

export async function GET(request: Request) {
  if (request.headers.get(NATIVE_APP_HEADER) !== '1') return json({ ok: false, error: 'アプリから開いてください' }, 400);
  return json(await loadDisplayScreenForApp());
}

export async function POST(request: Request) {
  if (request.headers.get(NATIVE_APP_HEADER) !== '1') return json({ ok: false, error: 'アプリから操作してください' }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: '内容が正しくありません' }, 400);
  }
  const parsed = parseDisplayAppAction(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const a = parsed.action;
  try {
    switch (a.type) {
      case 'pair': {
        const r = await pairDisplayDeviceWithCode(a.code);
        return json(r.error ? { ok: false, error: r.error } : { ok: true, storeName: r.storeName ?? '', kindLabel: r.kindLabel ?? 'ディスプレイ' });
      }
      case 'advance':
        await advanceDisplayItem(a.itemId, a.next);
        return json({ ok: true });
      case 'served':
        await markDisplayOrderServed(a.orderId, a.itemIds.length > 0 ? a.itemIds : undefined);
        return json({ ok: true });
      case 'heartbeat':
        return json(await displayHeartbeatServer());
      case 'leave':
        return json(await leaveDisplayDevice());
    }
  } catch (e) {
    return json({ ok: false, error: errorText(e, 'うまくいきませんでした。もう一度お試しください') });
  }
}
