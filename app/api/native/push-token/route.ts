import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isDeviceToken, isNativeApp } from '@/lib/apns';

/**
 * iPhone/iPad アプリ（ios/）が、端末の通知トークン（APNs）を登録する。
 * アプリの中の Web（ログインしているセッション）から送られるので、いまのアカウント・店舗に結びつける。
 *   レジ（regi）・ハンディ（handy）… いま選んでいる店舗
 *   オーナー（owner）… 会社全体（店舗なし）
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.organizationId) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { token?: unknown; app?: unknown; environment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isDeviceToken(body.token) || !isNativeApp(body.app)) return NextResponse.json({ ok: false }, { status: 400 });
  const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';
  const store = ctx.currentStore ?? (ctx.stores.length === 1 ? ctx.stores[0] : null);
  const storeId = body.app === 'owner' ? null : (store?.id ?? null);
  if (body.app !== 'owner' && !storeId) return NextResponse.json({ ok: false, reason: 'no-store' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { error } = await admin.from('native_push_tokens').upsert(
      {
        token: body.token.toLowerCase(),
        organization_id: ctx.organizationId,
        store_id: storeId,
        profile_id: ctx.userId,
        app: body.app,
        environment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );
    if (error) return NextResponse.json({ ok: false }, { status: 500 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
