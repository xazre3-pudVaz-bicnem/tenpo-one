import { NATIVE_APP_HEADER } from '@/lib/native-pos';
import { createClient } from '@/lib/supabase/server';

/**
 * iPhone アプリの店長・オーナーのログイン（ネイティブ。2026-10-25 02:29 Ronnie「アプリのログイン画面はそれぞれの形で」）。
 * Web の /login と同じ ID（メール）・パスワード（Supabase の signInWithPassword）。ログインの Cookie を返す
 * （アプリは返ってきた Cookie を WKWebView に入れて /app/dashboard を開く）。見る画面は役割で決まる（サーバー）。
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
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!email || !password) return Response.json({ ok: false, error: 'ID（メールアドレス）とパスワードを入れてください' });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // どちらが違うかは言わない（Web の /login と同じ）
  if (error) return Response.json({ ok: false, error: 'ID（メールアドレス）またはパスワードが正しくありません' });

  // 同じクライアントで（ログインしたばかりのセッションで）所属を確かめる
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  const { data: membership } = userId
    ? await supabase.from('memberships').select('role, organization_id').eq('profile_id', userId).eq('status', 'active').limit(1).maybeSingle()
    : { data: null };
  if (!membership) {
    await supabase.auth.signOut({ scope: 'local' });
    return Response.json({ ok: false, error: 'このアカウントは TENPO ONE の店舗に登録されていません' });
  }
  return Response.json({ ok: true, role: membership.role });
}
