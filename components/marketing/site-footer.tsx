import Link from 'next/link';
import { brand } from '@/lib/brand';
import { BrandLogo } from '@/components/layout/brand-logo';
import { FEATURE_CATEGORIES, FEATURE_PAGES, type FeatureCategoryKey } from '@/lib/marketing';

const CATEGORY_ORDER: FeatureCategoryKey[] = ['operations', 'backoffice', 'management'];

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <BrandLogo className="text-base" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-gray-500">
              {brand.taglineEn}<br />
              予約・POS・在庫・勤怠・会計・経営分析を、同じデータでつなぐ飲食店向け店舗管理プラットフォーム。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {CATEGORY_ORDER.map((key) => (
              <div key={key}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {FEATURE_CATEGORIES[key].label}
                </p>
                <ul className="mt-3 space-y-2">
                  {FEATURE_PAGES.filter((f) => f.category === key).map((f) => (
                    <li key={f.slug}>
                      <Link href={`/features/${f.slug}`} className="text-sm text-gray-600 hover:text-navy">
                        {f.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">サービス</p>
              <ul className="mt-3 space-y-2">
                <li><Link href="/features" className="text-sm text-gray-600 hover:text-navy">機能一覧</Link></li>
                <li><Link href="/pricing" className="text-sm text-gray-600 hover:text-navy">料金</Link></li>
                <li><Link href="/security" className="text-sm text-gray-600 hover:text-navy">セキュリティ</Link></li>
                <li><Link href="/company" className="text-sm text-gray-600 hover:text-navy">運営会社</Link></li>
                <li><Link href="/contact" className="text-sm text-gray-600 hover:text-navy">お問い合わせ</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-gray-200 pt-6 sm:flex-row sm:items-center">
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500" aria-label="フッターナビゲーション">
            <Link href="/privacy" className="hover:text-navy">プライバシーポリシー</Link>
            <Link href="/terms" className="hover:text-navy">利用規約</Link>
            <Link href="/login" className="hover:text-navy">ログイン</Link>
          </nav>
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} {brand.company}
          </p>
        </div>
      </div>
    </footer>
  );
}
