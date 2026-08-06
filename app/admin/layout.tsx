import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { BrandLogo } from '@/components/layout/brand-logo';
import { AdminNav } from '@/components/admin/admin-nav';
import { signOut } from '@/app/app/actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCypressAdmin();

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 bg-navy">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin/organizations" aria-label="運営管理トップへ">
              <BrandLogo className="text-lg" light />
            </Link>
            <span className="rounded-full bg-primary/20 px-2.5 py-1 text-[11px] font-semibold text-primary">
              運営管理
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-300 sm:inline">{ctx.displayName}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg p-2 text-gray-300 hover:bg-navy-soft hover:text-white"
                aria-label="ログアウト"
                title="ログアウト"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
