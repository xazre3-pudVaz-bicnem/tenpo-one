import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/layout/brand-logo';
import { brand } from '@/lib/brand';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'ログイン',
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandLogo className="text-3xl" />
          <p className="mt-2 text-sm text-gray-500">{brand.tagline}</p>
        </div>

        {params.error === 'no_membership' && (
          <div className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
            所属する企業がありません。管理者に招待を依頼してください。
          </div>
        )}

        <LoginForm next={params.next} />

        <div className="mt-6 space-y-2 text-center text-sm">
          <p>
            <Link href="/reset-password" className="text-primary hover:underline">
              パスワードをお忘れの方
            </Link>
          </p>
          <p className="text-xs text-gray-400">
            アカウントは所属企業の管理者から発行されます
          </p>
        </div>
      </div>
    </div>
  );
}
