import Link from 'next/link';
import { Bell, LogOut } from 'lucide-react';
import type { SessionContext } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/permissions';
import { signOut } from '@/app/app/actions';
import { StoreSwitcher } from './store-switcher';
import { BrandLogo } from './brand-logo';

export function TopBar({ ctx, unreadCount }: { ctx: SessionContext; unreadCount: number }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 lg:pl-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/app/dashboard" className="lg:hidden" aria-label="ダッシュボードへ">
          <BrandLogo className="text-base" />
        </Link>
        <div className="hidden sm:block">
          <StoreSwitcher
            stores={ctx.stores}
            currentStoreId={ctx.currentStore?.id ?? null}
            allowAll={ctx.isHq}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-3">
        <Link
          href="/app/notifications"
          className="relative rounded-lg p-2 text-gray-600 hover:bg-gray-100"
          aria-label={`通知 ${unreadCount}件の未読`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div className="hidden items-end text-right sm:flex sm:flex-col">
          <span className="text-sm font-medium text-navy">{ctx.displayName}</span>
          <span className="text-[11px] text-gray-500">
            {ctx.role ? ROLE_LABELS[ctx.role] : ctx.isCypressAdmin ? '運営管理者' : ''}
          </span>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-danger"
            aria-label="ログアウト"
            title="ログアウト"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      </div>
    </header>
  );
}
