import { NextResponse } from 'next/server';
import pkg from '@/package.json';

/**
 * ヘルスチェック（秘密情報は返さない）。
 * App稼働 + Supabase(DB)疎通 + auth設定有無 + アプリバージョン/環境の最小確認。
 * 運営コンソールの状態表示（/admin/status, /admin/system）から参照する。
 * db/authの判定基準は既存踏襲（dbのみが200/503を左右する。authは参考情報）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  let db: 'ok' | 'error' | 'unconfigured' = 'unconfigured';
  let dbLatencyMs: number | null = null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    try {
      const t0 = Date.now();
      // 認証不要のRESTルートで疎通確認（5秒タイムアウト）
      const res = await fetch(`${url}/rest/v1/plans?select=code&limit=1`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      dbLatencyMs = Date.now() - t0;
      db = res.ok ? 'ok' : 'error';
    } catch {
      db = 'error';
    }
  }

  // auth設定の存在確認（値そのものは返さず、有無のみ。service roleキーの有無も併記）
  const auth: 'ok' | 'unconfigured' = url && anonKey ? 'ok' : 'unconfigured';
  const authAdminConfigured = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';

  const healthy = db === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      app: 'ok',
      db,
      dbLatencyMs,
      auth,
      authAdminConfigured,
      version: pkg.version,
      environment,
      responseMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
