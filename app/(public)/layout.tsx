import Link from 'next/link';
import { BrandLogo } from '@/components/layout/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { brand } from '@/lib/brand';

/**
 * 公開ページ共通レイアウト。
 * /book /booking 配下（別担当実装）にも適用されるため、シンプルで邪魔にならない構成にする。
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label={`${brand.name} トップへ`}>
            <BrandLogo className="text-lg" />
          </Link>
          <nav className="flex items-center gap-4 sm:gap-6" aria-label="サイトナビゲーション">
            <Link
              href="/pricing"
              className="text-sm font-medium text-navy hover:text-primary-deep"
            >
              料金
            </Link>
            <Link href="/login" className={buttonVariants({ size: 'sm' })}>
              ログイン
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-gray-100 bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <BrandLogo className="text-base" />
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500" aria-label="フッターナビゲーション">
              <Link href="/pricing" className="hover:text-navy">料金</Link>
              <Link href="/privacy" className="hover:text-navy">プライバシーポリシー</Link>
              <Link href="/terms" className="hover:text-navy">利用規約</Link>
              <Link href="/login" className="hover:text-navy">ログイン</Link>
            </nav>
          </div>
          <p className="mt-6 text-xs text-gray-400">
            &copy; {new Date().getFullYear()} {brand.company}
          </p>
        </div>
      </footer>
    </div>
  );
}
