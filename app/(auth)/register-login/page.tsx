import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/layout/brand-logo';
import { RegisterLoginForm } from './register-login-form';

export const metadata: Metadata = {
  title: 'レジ（iPad）のログイン',
  robots: { index: false },
};

export default function RegisterLoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandLogo className="text-3xl" />
          <p className="mt-2 text-sm text-gray-500">レジ（iPad）のログイン</p>
        </div>

        <RegisterLoginForm />

        <div className="mt-6 space-y-2 text-center text-sm">
          <p className="text-xs text-gray-400">
            企業番号・店舗ユーザー名・レジ用パスワードは、TENPO ONE から店舗へお渡ししています
          </p>
          <p>
            <Link href="/login" className="text-primary hover:underline">
              パソコンからのログインはこちら
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
