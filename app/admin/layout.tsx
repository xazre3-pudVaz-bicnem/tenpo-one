import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { AdminNav } from '@/components/admin/admin-nav';
import { signOut } from '@/app/app/actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCypressAdmin();

  return (
    // 色とロゴはお店の管理画面（パソコン）と同じ（2026-10-26 Ronnie「色もロゴも全部合わせる」）：
    // theme-admin（チャコールのバー・青のアクセント・薄い灰色の地。app/globals.css）、ロゴは上のバーと同じ白い角丸のマーク
    <div className="theme-admin min-h-screen bg-surface">
      <header className="sticky top-0 z-30 bg-navy">
        <span aria-hidden className="bg-brand pointer-events-none absolute inset-x-0 bottom-0 h-[3px]" />
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin/organizations" aria-label="運営管理トップへ" className="flex items-center gap-2.5">
              <span className="bg-brand grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] p-[2px]">
                <span className="grid h-full w-full place-items-center rounded-[8px] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-mark.png" alt="" className="h-6 w-6" />
                </span>
              </span>
              <span className="text-lg font-bold tracking-tight text-white">TENPO ONE</span>
            </Link>
            <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-white">運営管理</span>
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
