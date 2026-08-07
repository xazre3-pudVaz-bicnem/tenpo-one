import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  // 完全なCSPはNext.jsのインラインスクリプトとの整合検証後に導入予定
  // （docs/known-limitations.md参照）。frame-ancestorsのみ先行して制限する。
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  // HSTSは本番（HTTPS）のみ有効化
  ...(process.env.NODE_ENV === 'production'
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
