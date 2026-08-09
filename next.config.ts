import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content-Security-Policy を組み立てる。
 * Next.js App Router はハイドレーション用のインラインスクリプト（__NEXT_DATA__ 等）や
 * 一部のインラインスタイルを埋め込むため script-src / style-src に 'unsafe-inline' が必要。
 * nonce方式（リクエスト毎にnonceを発行しscript-src 'nonce-...'にする）が理想だが、
 * next.config.ts の headers() はリクエストに依存しない静的関数のためnonceを差し込めない。
 * そのため 'unsafe-inline' を最小限（script-src / style-src のみ）にとどめ、
 * base-uri 'none' / object-src 'none' / default-src 'self' 等で他の攻撃面を絞る。
 * 将来 middleware 経由でnonceを発行する方式へ移行する余地を残す。
 */
function buildCsp(): string {
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
    : null;

  const connectSrc = ["'self'"];
  const imgSrc = ["'self'", 'data:', 'blob:'];
  if (supabaseHost) {
    // Supabase REST/Storage(https) と Realtime(wss) の両方を許可する
    connectSrc.push(`https://${supabaseHost}`, `wss://${supabaseHost}`);
    imgSrc.push(`https://${supabaseHost}`);
  }
  if (!isProd) {
    // 開発環境: next dev のHot Module Replacement(WebSocket)を許可
    connectSrc.push('ws://localhost:*', 'ws://127.0.0.1:*', 'http://localhost:*');
  }

  return [
    `default-src 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${imgSrc.join(' ')}`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc.join(' ')}`,
  ].join('; ');
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  // 本番は実効ポリシーとして強制。開発環境はNext.jsの開発体験（Fast Refresh等）を壊さないよう
  // Report-Only（違反はコンソールに出るがブロックはしない）にする。
  {
    key: isProd ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: buildCsp(),
  },
  // HSTSは本番（HTTPS）のみ有効化
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      // Supabase Storage（環境変数のホストからの画像を許可）
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [{ protocol: 'https' as const, hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname }]
        : []),
    ],
  },
};

export default nextConfig;
