import type { Metadata } from 'next';
import { BrandLogo } from '@/components/layout/brand-logo';
import { UpdatePasswordForm } from './update-form';

export const metadata: Metadata = { title: '新しいパスワードの設定', robots: { index: false } };

export default function UpdatePasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandLogo className="text-3xl" />
          <p className="mt-2 text-sm text-gray-500">新しいパスワードの設定</p>
        </div>
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
