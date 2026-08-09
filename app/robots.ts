import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * 業務システム（/app・/admin）と認証・店舗別動的ページはクロール対象外にする。
 * NEXT_PUBLIC_SITE_URL 未設定時は全体を Disallow（プレビューの誤インデックス防止）。
 */
export default function robots(): MetadataRoute.Robots {
  if (!siteUrl) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/admin/', '/login', '/book/', '/booking/', '/order/', '/reset-password'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
