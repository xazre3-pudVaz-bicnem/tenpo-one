import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/layout/brand-logo';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'パスワード再設定', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandLogo className="text-3xl" />
          <p className="mt-2 text-sm text-gray-500">パスワード再設定</p>
        </div>
        <ResetForm />
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            ログインへ戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
