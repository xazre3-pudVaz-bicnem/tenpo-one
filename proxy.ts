import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 の proxy 規約（旧 middleware）。
 * - Supabaseセッションの更新と /app・/admin の認証ガード
 * - x-pathname ヘッダーの付与（レイアウトでの現在パス判定に使用。
 *   オンボーディング未完了リダイレクトの無限ループ防止）
 */
export default async function proxy(request: NextRequest) {
  const withPathname = () => {
    const h = new Headers(request.headers);
    h.set('x-pathname', request.nextUrl.pathname);
    return h;
  };

  // 環境変数未設定（デプロイ直後など）でも全リクエストを500にしない。
  // 認証ガードは各ページ側の requireSession が二重に守っているため、
  // ここでは素通しにして分かりやすいエラー表示に委ねる。
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error(
      '[TENPO ONE] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。' +
        'Vercelの環境変数を設定して再デプロイしてください（docs/deployment.md参照）'
    );
    return NextResponse.next({ request: { headers: withPathname() } });
  }

  const { pathname } = request.nextUrl;

  // 認証が関係しないルート（LP・公開予約・QRオーダー・Webhook・ヘルスチェック等）は
  // Supabaseへのセッション照会を行わない（公開ページのTTFB改善。
  // /app・/admin は下のガードで検証し、各ページの requireSession が最終防衛線）。
  const needsAuth =
    pathname.startsWith('/app') || pathname.startsWith('/admin') || pathname === '/login';
  if (!needsAuth) {
    return NextResponse.next({ request: { headers: withPathname() } });
  }

  let response = NextResponse.next({ request: { headers: withPathname() } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: withPathname() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = pathname.startsWith('/app') || pathname.startsWith('/admin');

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/login' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/app/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};
