import Link from 'next/link';
import { Bell, LogOut, Menu, UserRound } from 'lucide-react';
import type { SessionContext } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/permissions';
import { signOut } from '@/app/app/actions';
import { CommandPaletteIconTrigger } from '@/components/search/command-palette';
import { HelpPopover } from '@/components/help/help-popover';
import { StoreSwitcher } from './store-switcher';
import { BackHome, LiveClock, ScreenTitle } from './top-bar-parts';

/**
 * 上部バー（濃紫・高さ58px）。D&DREAM レジ v32 準拠:
 *   左: ホームへ戻る・ブランド・店舗ピル / 中央: 画面タイトル（日英） / 右: 日時・通知・ユーザー
 */
export function TopBar({
  ctx,
  unreadCount,
  showMenuLink = false,
}: {
  ctx: SessionContext;
  unreadCount: number;
  /** 左メニューを出さない画面（レジ全画面）で、代わりにメニュー画面へのボタンを出す */
  showMenuLink?: boolean;
}) {
  const roleLabel = ctx.role ? ROLE_LABELS[ctx.role] : ctx.isCypressAdmin ? '運営管理者' : '';
  return (
    <header className="sticky top-0 z-40 grid h-[58px] grid-cols-[1fr_auto_1fr] items-center gap-4 bg-plum px-3 text-white sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {showMenuLink && (
          <Link
            href="/app/menu"
            aria-label="メニュー"
            title="メニュー / Menu"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/12 px-2 py-1.5 text-[13px] font-semibold text-white hover:bg-white/20"
          >
            <Menu className="h-[18px] w-[18px]" />
            <span className="hidden md:inline">メニュー</span>
          </Link>
        )}
        <BackHome />
        <Link
          href="/app/dashboard"
          aria-label="ホームへ"
          className="flex shrink-0 items-center gap-3 rounded-[10px] py-0.5 pr-1.5 pl-0.5 transition-colors hover:bg-white/10"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="h-6 w-6" />
          </span>
          <span className="hidden text-[15px] font-bold whitespace-nowrap xl:inline">TENPO ONE</span>
        </Link>
        <div className="hidden min-w-0 sm:block">
          <StoreSwitcher
            tone="dark"
            stores={ctx.stores}
            currentStoreId={ctx.currentStore?.id ?? null}
            allowAll={ctx.isHq}
          />
        </div>
      </div>

      <ScreenTitle />

      <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
        <span className="mr-2 hidden xl:inline-flex">
          <LiveClock />
        </span>
        <CommandPaletteIconTrigger tone="dark" />
        <span className="hidden text-white sm:inline-flex [&_button]:text-white [&_button:hover]:bg-white/10">
          <HelpPopover />
        </span>
        <Link
          href="/app/notifications"
          className="relative rounded-lg p-2 text-white hover:bg-white/10"
          aria-label={`アラート ${unreadCount}件の未読`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <span
          className="hidden max-w-[200px] items-center gap-1.5 rounded-full bg-white/12 py-1 pr-3 pl-2 text-[13px] font-medium whitespace-nowrap md:inline-flex"
          title={roleLabel}
        >
          <UserRound className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate">{ctx.displayName}</span>
          {roleLabel && <span className="hidden truncate text-[11px] text-[#D9CCF3] 2xl:inline">{roleLabel}</span>}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
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
