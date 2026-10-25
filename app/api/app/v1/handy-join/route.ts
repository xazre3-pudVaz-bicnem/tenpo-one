import { NATIVE_APP_HEADER } from '@/lib/native-pos';
import { joinHandyByQr } from '@/app/handy-join/actions';

/**
 * iPhone アプリのハンディの QR ログイン（ネイティブ。2026-10-25 09:39 Ronnie「ログインもログアウトもブラウザに行かないように」）。
 * お店の「ハンディ QR」（/handy-join#<値>）をアプリのカメラで読んだら、Web の /handy-join を開かずにここへ送る。
 * 中身は Web の /handy-join と同じ joinHandyByQr（QR の確認・お店の Wi-Fi・台数・端末のログイン）。ログインの Cookie を返す
 * （アプリは返ってきた Cookie を WKWebView に入れて /handy を開く）。Web の /handy-join はそのまま（ブラウザのハンディ用）。
 */
export async function POST(request: Request) {
  if (request.headers.get(NATIVE_APP_HEADER) !== '1') {
    return Response.json({ ok: false, error: 'アプリから操作してください' }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: '内容が正しくありません' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim().slice(0, 200) : '';
  if (!token) return Response.json({ ok: false, error: 'お店の「ハンディ QR」を読んでください' });
  const result = await joinHandyByQr(token);
  return Response.json(result.ok ? { ok: true, storeName: result.storeName } : { ok: false, error: result.error });
}
