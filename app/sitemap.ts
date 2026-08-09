import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * 公開マーケティングページのみを sitemap に含める。
 * /app・/admin 等の業務システムや /book・/booking の店舗別動的ページは対象外。
 * NEXT_PUBLIC_SITE_URL 未設定のプレビュー環境では空を返す（誤インデックス防止）。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteUrl) return [];

  const paths = [
    '',
    '/features',
    '/features/reservations',
    '/features/pos',
    '/features/qr-kds',
    '/features/crm',
    '/features/inventory',
    '/features/accounting',
    '/features/workforce',
    '/features/analytics',
    '/features/multi-store',
    '/security',
    '/pricing',
    '/contact',
    '/company',
    '/privacy',
    '/terms',
  ];

  const now = new Date();
  return paths.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: path === '' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : path.startsWith('/features') ? 0.8 : 0.6,
  }));
}
