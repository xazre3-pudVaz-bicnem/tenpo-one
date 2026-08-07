import Link from 'next/link';
import { BrandLogo } from '@/components/layout/brand-logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <BrandLogo className="text-2xl" />
      <p className="mt-8 text-6xl font-bold text-navy">404</p>
      <h1 className="mt-3 text-lg font-semibold text-navy">ページが見つかりません</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        URLが変更されたか、削除された可能性があります。アドレスをご確認ください。
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/"
          className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-navy hover:bg-gray-50"
        >
          トップページ
        </Link>
        <Link
          href="/app/dashboard"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-deep"
        >
          ダッシュボード
        </Link>
      </div>
    </div>
  );
}
