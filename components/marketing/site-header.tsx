'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { brand } from '@/lib/brand';
import { buttonVariants } from '@/components/ui/button';
import { BrandLogo } from '@/components/layout/brand-logo';
import { FEATURE_CATEGORIES, FEATURE_PAGES, type FeatureCategoryKey } from '@/lib/marketing';

const CATEGORY_ORDER: FeatureCategoryKey[] = ['operations', 'backoffice', 'management'];

export function SiteHeader() {
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label={`${brand.name} トップへ`} onClick={() => setMobileOpen(false)}>
          <BrandLogo className="text-lg" />
        </Link>

        {/* PCナビ */}
        <nav className="hidden items-center gap-6 lg:flex" aria-label="サイトナビゲーション">
          <div
            className="relative"
            onMouseEnter={() => setMegaOpen(true)}
            onMouseLeave={() => setMegaOpen(false)}
          >
            <button
              type="button"
              className="flex items-center gap-1 py-2 text-sm font-medium text-navy hover:text-primary-deep"
              aria-expanded={megaOpen}
              onClick={() => setMegaOpen((v) => !v)}
            >
              機能
              <ChevronDown className={cn('h-4 w-4 transition-transform', megaOpen && 'rotate-180')} />
            </button>
            {megaOpen && (
              <div className="absolute left-1/2 top-full w-[720px] -translate-x-1/2 pt-2">
                <div className="grid grid-cols-3 gap-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-xl ring-1 ring-black/5">
                  {CATEGORY_ORDER.map((key) => (
                    <div key={key}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                        {FEATURE_CATEGORIES[key].label}
                      </p>
                      <ul className="mt-3 space-y-2">
                        {FEATURE_PAGES.filter((f) => f.category === key).map((f) => (
                          <li key={f.slug}>
                            <Link
                              href={`/features/${f.slug}`}
                              className="block rounded-md py-1 text-sm text-gray-600 hover:text-primary-deep"
                              onClick={() => setMegaOpen(false)}
                            >
                              {f.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div className="col-span-3 border-t border-gray-100 pt-4">
                    <Link
                      href="/features"
                      className="text-sm font-semibold text-primary-deep hover:underline"
                      onClick={() => setMegaOpen(false)}
                    >
                      すべての機能を見る →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
          <Link href="/pricing" className="text-sm font-medium text-navy hover:text-primary-deep">料金</Link>
          <Link href="/security" className="text-sm font-medium text-navy hover:text-primary-deep">セキュリティ</Link>
          <Link href="/company" className="text-sm font-medium text-navy hover:text-primary-deep">導入について</Link>
        </nav>

        {/* 右側アクション */}
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="text-sm font-medium text-navy hover:text-primary-deep">
            ログイン
          </Link>
          <Link href="/contact" className={buttonVariants({ size: 'sm' })}>
            デモ・相談
          </Link>
        </div>

        {/* モバイルトグル */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-navy lg:hidden"
          aria-label={mobileOpen ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* モバイルメニュー */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white lg:hidden">
          <div className="max-h-[calc(100vh-4rem)] space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
            {CATEGORY_ORDER.map((key) => (
              <div key={key}>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {FEATURE_CATEGORIES[key].label}
                </p>
                <ul className="mt-2 space-y-1">
                  {FEATURE_PAGES.filter((f) => f.category === key).map((f) => (
                    <li key={f.slug}>
                      <Link
                        href={`/features/${f.slug}`}
                        className="block py-1.5 text-sm text-gray-700"
                        onClick={() => setMobileOpen(false)}
                      >
                        {f.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="space-y-1 border-t border-gray-100 pt-4">
              <Link href="/features" className="block py-1.5 text-sm font-semibold text-primary-deep" onClick={() => setMobileOpen(false)}>すべての機能を見る</Link>
              <Link href="/pricing" className="block py-1.5 text-sm text-navy" onClick={() => setMobileOpen(false)}>料金</Link>
              <Link href="/security" className="block py-1.5 text-sm text-navy" onClick={() => setMobileOpen(false)}>セキュリティ</Link>
              <Link href="/company" className="block py-1.5 text-sm text-navy" onClick={() => setMobileOpen(false)}>導入について</Link>
              <Link href="/login" className="block py-1.5 text-sm text-navy" onClick={() => setMobileOpen(false)}>ログイン</Link>
            </div>
            <Link href="/contact" className={cn(buttonVariants({ size: 'lg' }), 'w-full')} onClick={() => setMobileOpen(false)}>
              デモ・相談
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
