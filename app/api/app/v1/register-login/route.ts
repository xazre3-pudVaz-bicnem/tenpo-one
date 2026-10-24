import { NATIVE_APP_HEADER } from '@/lib/native-pos';
import { loginRegisterDevice } from '@/lib/register-login-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadStoreClerks } from '@/lib/pos-clerks-server';

/**
 * iPad アプリのネイティブのレジのログイン（2026-10-25 02:29 Ronnie「iPad は 企業番号・店舗コード・パスワード だけ。
 * パスワードが合ったらすぐ担当選択 → レジ」）。中身は Web の /register-login と同じ loginRegisterDevice（ログインの Cookie を返す。
 * アプリは返ってきた Cookie を WKWebView に入れる）。担当選択に使う POS担当者の一覧も返す。
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
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const result = await loginRegisterDevice({
    orgCode: str(body.orgCode, 32),
    storeUser: str(body.storeUser, 64),
    password: str(body.password, 128),
  });
  if (result.error || !result.ok) {
    return Response.json({ ok: false, error: result.error ?? 'ログインできませんでした' }, { status: 200 });
  }
  // 担当選択の候補（この店の POS担当者）。ログインできたあとだけ
  let clerks: { id: string; name: string; role: string }[] = [];
  try {
    const admin = createAdminClient() as unknown as Parameters<typeof loadStoreClerks>[0];
    const rows = await loadStoreClerks(admin, result.ok.storeId);
    clerks = rows.map((c) => ({ id: c.id, name: c.name, role: c.role }));
  } catch {
    clerks = [];
  }
  return Response.json({ ok: true, store: { id: result.ok.storeId, name: result.ok.storeName }, clerks });
}
