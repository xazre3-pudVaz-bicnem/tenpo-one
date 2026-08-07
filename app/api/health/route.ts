import { NextResponse } from 'next/server';

/**
 * ヘルスチェック（秘密情報は返さない）。
 * App稼働 + Supabase(DB)疎通の最小確認。運営コンソールの状態表示から参照する。
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

  const healthy = db === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      app: 'ok',
      db,
      dbLatencyMs,
      responseMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
