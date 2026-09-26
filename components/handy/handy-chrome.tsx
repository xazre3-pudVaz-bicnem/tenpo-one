'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  House,
  LogOut,
  Menu,
  NotebookText,
  PackageX,
  RotateCw,
  ShoppingCart,
  UserRound,
  UserRoundPen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { signOut } from '@/app/app/actions';
import { StoreSwitcher } from '@/components/layout/store-switcher';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { ReservationAlert } from '@/components/notifications/reservation-alert';
import { PushSubscribeButton } from '@/components/notifications/push-subscribe-button';
import { useNow } from '@/components/floor/use-now';
import type { StoreRef } from '@/lib/auth';
import { elapsedLabel, serviceCallLabel, sortServiceCalls, type HandyServiceCall } from './logic';

/**
 * 承認済みレイアウト（2026-09-21）のハンディは、TENPO ONE本体の上部バー・左メニュー・下部5タブが
 * 無い「全画面アプリ」。この画面だけで完結するよう、外枠（濃紫の上部バー／下部のSELECT・HANDY・
 * RESERVATION／呼び出しバナー）をここにまとめる。
 *
 * 配色は本体の .theme-regi に依存できないため（/handy は /app の外）、外枠側で theme-regi を
 * 付けたうえで、プロトタイプの色は直接指定する（#241436 / #7b3fe4 / #f6f3fb …）。
 */

interface HandyChromeApi {
  openDrawer: () => void;
  refresh: () => void;
  refreshing: boolean;
}

const HandyChromeContext = createContext<HandyChromeApi>({
  openDrawer: () => {},
  refresh: () => {},
  refreshing: false,
});

export function useHandyChrome() {
  return useContext(HandyChromeContext);
}

/* ------------------------------------------------------------------ 外枠 */

export function HandyChrome({
  storeId,
  storeName,
  staffName,
  clerkSelected,
  changeClerkAction,
  stores,
  currentStoreId,
  allowAll,
  calls,
  serverNow,
  resolveServiceCallAction,
  children,
}: {
  storeId: string;
  storeName: string;
  staffName: string;
  /** ログイン画面で担当者を選び終えているか（選ぶ前はドロワーに「担当者を変更」を出さない） */
  clerkSelected: boolean;
  /** 担当者の選択を消してログイン画面へ戻す */
  changeClerkAction: () => Promise<void>;
  stores: StoreRef[];
  currentStoreId: string | null;
  allowAll: boolean;
  calls: HandyServiceCall[];
  serverNow: number;
  resolveServiceCallAction: (callId: string) => Promise<{ alreadyResolved: boolean }>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const onReservations = pathname.startsWith('/handy/reservations');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [callsOpen, setCallsOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  // 注文・呼び出しは他端末やお客様QRからも増える。router.refresh() は外枠（layout）と
  // 画面（page）の両方を取り直すため、購読はここ1か所にまとめる。
  useStoreRealtimeRefresh({
    storeId,
    tables: ['orders', 'order_items', 'restaurant_tables', 'service_calls'],
  });

  const sorted = sortServiceCalls(calls);
  const api: HandyChromeApi = {
    openDrawer: () => setDrawerOpen(true),
    refresh: () => startRefresh(() => router.refresh()),
    refreshing,
  };

  return (
    <HandyChromeContext.Provider value={api}>
      <div className="theme-regi fixed inset-0 flex flex-col overflow-hidden bg-[#f6f3fb] text-[#2a2138]">
        {children}
        {/* 新しいネット予約のチャイム＋バナー */}
        <ReservationAlert storeId={storeId} ledgerHref="/handy/reservations" />

        <div className="flex-none">
          {sorted.length > 0 && (
            <button
              type="button"
              onClick={() => setCallsOpen(true)}
              aria-label={`未対応の呼び出し ${sorted.length}件`}
              className="flex min-h-[54px] w-full items-center justify-between gap-1.5 border-t-2 border-[#ee853e] bg-[#fff1e6] px-3 py-2 text-left text-xs text-[#842f0b]"
            >
              <span className="shrink-0">
                呼び出し{' '}
                <b className="rounded-[9px] bg-[#b44814] px-1.5 py-0.5 font-bold text-white">
                  {sorted.length}件
                </b>
              </span>
              <strong className="max-w-[42%] truncate text-[15px] font-bold">
                {[
                  ...new Set(
                    sorted.map(
                      (c) => `${c.tableName ?? '—'}${c.kind === 'checkout' ? ' 会計希望' : ''}`
                    )
                  ),
                ].join('・')}
              </strong>
              <small className="max-w-[75px] shrink-0 text-[9px] leading-tight">
                未対応 · タップして確認 ›
              </small>
            </button>
          )}

          <nav
            aria-label="アプリ切り替え"
            className="border-t border-[#e3dbf1] bg-white px-2 pb-[calc(6px+env(safe-area-inset-bottom))]"
          >
            <button
              type="button"
              onClick={() => setSelectOpen(true)}
              className="mx-auto block min-h-[22px] px-[18px] py-0.5 text-[8px] font-bold tracking-[1.4px] text-[#8a769d]"
            >
              SELECT ▴
            </button>
            <div className="grid grid-cols-2 gap-[7px]">
              <Link
                href="/handy"
                aria-current={onReservations ? undefined : 'page'}
                className={cn(
                  'flex min-h-[46px] items-center justify-center gap-2.5 rounded-[9px] text-[11px] font-extrabold tracking-[0.5px]',
                  onReservations
                    ? 'text-[#8a769d] active:bg-[#f6f3fb]'
                    : 'bg-[#efeaf8] text-[#7b3fe4]'
                )}
              >
                <ShoppingCart className="h-[21px] w-[21px]" aria-hidden />
                HANDY
              </Link>
              <Link
                href="/handy/reservations"
                aria-current={onReservations ? 'page' : undefined}
                className={cn(
                  'flex min-h-[46px] items-center justify-center gap-2.5 rounded-[9px] text-[11px] font-extrabold tracking-[0.5px]',
                  onReservations
                    ? 'bg-[#efeaf8] text-[#7b3fe4]'
                    : 'text-[#8a769d] active:bg-[#f6f3fb]'
                )}
              >
                <NotebookText className="h-[21px] w-[21px]" aria-hidden />
                RESERVATION
              </Link>
            </div>
          </nav>
        </div>
      </div>

      {drawerOpen && (
        <HandySheet title="TENPO ONE" onClose={() => setDrawerOpen(false)}>
          <p className="mb-3 text-[11px] leading-relaxed text-[#8a769d]">
            {storeName} ／ {staffName}
          </p>
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-[#eee8f6] py-2">
            <span className="text-sm font-bold text-[#4f3868]">店舗</span>
            <StoreSwitcher stores={stores} currentStoreId={currentStoreId} allowAll={allowAll} />
          </div>
          {clerkSelected && (
            <form action={changeClerkAction}>
              <button
                type="submit"
                className="flex min-h-[49px] w-full items-center gap-2 border-b border-[#eee8f6] text-left text-sm text-[#7b3fe4]"
              >
                <UserRoundPen className="h-[18px] w-[18px]" aria-hidden />
                担当者を変更（{staffName}）
                <ChevronRight className="ml-auto h-4 w-4 text-[#c9b8ea]" aria-hidden />
              </button>
            </form>
          )}
          <SheetLink href="/app/dashboard" icon={<House className="h-[18px] w-[18px]" aria-hidden />}>
            TENPO ONE（本体）へ戻る
          </SheetLink>
          <SheetLink
            href="/handy/reservations"
            icon={<NotebookText className="h-[18px] w-[18px]" aria-hidden />}
          >
            今日の予約
          </SheetLink>
          <SheetLink href="/handy/sold-out" icon={<PackageX className="h-[18px] w-[18px]" aria-hidden />}>
            品切れ設定（売切・販売再開）
          </SheetLink>
          <PushSubscribeButton variant="row" />
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              setCallsOpen(true);
            }}
            className="flex min-h-[49px] w-full items-center justify-between gap-2 border-b border-[#eee8f6] text-left text-sm text-[#7b3fe4]"
          >
            <span className="flex items-center gap-2">
              <UserRound className="h-[18px] w-[18px]" aria-hidden />
              お客様の呼び出し
            </span>
            <span className="text-xs text-[#8a769d]">{sorted.length}件</span>
          </button>
          <form action={signOut}>
            <button
              type="submit"
              className="flex min-h-[49px] w-full items-center gap-2 border-b border-[#eee8f6] text-left text-sm text-[#b3341f]"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden />
              ログアウト
            </button>
          </form>
        </HandySheet>
      )}

      {selectOpen && (
        <HandySheet title="SELECT" onClose={() => setSelectOpen(false)}>
          <SheetLink href="/handy" icon={<ShoppingCart className="h-[18px] w-[18px]" aria-hidden />}>
            HANDY · 注文
          </SheetLink>
          <SheetLink
            href="/handy/reservations"
            icon={<NotebookText className="h-[18px] w-[18px]" aria-hidden />}
          >
            RESERVATION · 今日の予約
          </SheetLink>
        </HandySheet>
      )}

      {callsOpen && (
        <HandyCallsSheet
          calls={sorted}
          serverNow={serverNow}
          resolveServiceCallAction={resolveServiceCallAction}
          onClose={() => setCallsOpen(false)}
        />
      )}
    </HandyChromeContext.Provider>
  );
}

/* -------------------------------------------------------------- 上部バー */

/** プロトタイプの `.top`（濃紫・高さ53px・左右110pxの3分割） */
export function HandyTopBar({
  left,
  title,
  storeName,
  right,
}: {
  left?: React.ReactNode;
  title: string;
  /** 指定すると画面名の上に小さく店舗名を出す（テーブル一覧の見出し） */
  storeName?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex-none bg-[#241436] text-white">
      <div className="grid min-h-[53px] grid-cols-[110px_1fr_110px] items-center border-b border-[#3a2356] px-[7px] max-[350px]:grid-cols-[86px_1fr_86px]">
        {left ?? <span />}
        <div className="min-w-0 py-0.5 text-center">
          {storeName && (
            <span className="flex h-[26px] items-center justify-center truncate text-[10px] text-[#ded1ed]">
              {storeName}
            </span>
          )}
          <h1 className="truncate text-[15px] leading-[1.3] font-bold text-white">{title}</h1>
        </div>
        {right ?? <span />}
      </div>
    </header>
  );
}

/** 左端のハンバーガー（外枠のドロワーを開く） */
export function HandyMenuButton() {
  const { openDrawer } = useHandyChrome();
  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label="メニューを開く"
      className="flex h-11 w-11 items-center justify-center text-white"
    >
      <Menu className="h-7 w-7" strokeWidth={2.2} aria-hidden />
    </button>
  );
}

/** 右端の更新ボタン */
export function HandyRefreshButton() {
  const { refresh, refreshing } = useHandyChrome();
  return (
    <button
      type="button"
      onClick={refresh}
      aria-label="この画面を更新"
      className="flex h-11 w-11 items-center justify-center justify-self-end text-white disabled:opacity-50"
      disabled={refreshing}
    >
      <RotateCw className={cn('h-7 w-7', refreshing && 'animate-spin')} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

/** 左端の戻る（`‹ テーブル一覧`）。onClick を渡すと画面内の戻る（メニュー↔注文確認）になる */
export function HandyBackButton({
  href,
  label,
  onClick,
}: {
  href?: string;
  label: string;
  onClick?: () => void;
}) {
  const className =
    'flex min-h-11 items-center gap-0.5 text-xs font-medium text-[#ded1ed] active:text-white';
  const body = (
    <>
      <ChevronLeft className="h-[19px] w-[19px] shrink-0" strokeWidth={2.2} aria-hidden />
      <span className="truncate">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href ?? '/handy'} className={className}>
      {body}
    </Link>
  );
}

/* ------------------------------------------------------- 担当者バー・本文 */

/** プロトタイプの `.operator`（左に担当者名や卓、右肩に補足） */
export function HandyOperatorBar({
  label,
  note,
  showIcon = true,
}: {
  label: string;
  note?: string;
  showIcon?: boolean;
}) {
  return (
    <div className="flex min-h-[28px] flex-none items-center gap-[7px] px-2.5 py-1.5 text-[13px] text-[#5e4777]">
      {showIcon && <UserRound className="h-[17px] w-[17px] shrink-0 text-[#a69bbb]" aria-hidden />}
      <b className={cn('min-w-0 truncate', showIcon ? 'font-bold' : 'font-normal')}>{label}</b>
      {note && <span className="ml-auto shrink-0 text-[9px] text-[#8a769d]">{note}</span>}
    </div>
  );
}

/** スクロールする本文（下部の固定バーは main の外に置く） */
export function HandyMain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}>
      {children}
    </main>
  );
}

/** 画面下の主ボタン（プロトタイプの `.confirm-footer > .blue`） */
export function HandyFooterButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="flex-none bg-[#f6f3fb] px-3.5 pt-3 pb-2.5">
      <button
        type="button"
        className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-[9px] bg-[#7b3fe4] px-4 text-base font-bold text-white shadow-[0_3px_10px_#7b3fe41a] active:bg-[#6630c7] disabled:opacity-40"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- シート類 */

function SheetLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[49px] items-center gap-2 border-b border-[#eee8f6] text-sm text-[#7b3fe4]"
    >
      {icon}
      {children}
      <ChevronRight className="ml-auto h-4 w-4 text-[#c9b8ea]" aria-hidden />
    </Link>
  );
}

function HandySheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24143688] p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-[370px] overflow-y-auto rounded-xl bg-white p-5 shadow-[0_20px_90px_#0005]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-[#2a2138]">{title}</h2>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-[43px] w-full rounded-lg bg-[#efeaf8] text-center text-sm font-bold text-[#5e4777]"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function HandyCallsSheet({
  calls,
  serverNow,
  resolveServiceCallAction,
  onClose,
}: {
  calls: HandyServiceCall[];
  serverNow: number;
  resolveServiceCallAction: (callId: string) => Promise<{ alreadyResolved: boolean }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleResolve = (call: HandyServiceCall) => {
    if (pending) return;
    setBusy(call.id);
    startTransition(async () => {
      try {
        const result = await resolveServiceCallAction(call.id);
        setMessage(
          result.alreadyResolved
            ? 'この呼び出しは既に対応済みでした'
            : `${call.tableName ?? '卓'} の${serviceCallLabel(call.kind)}を対応済みにしました`
        );
        router.refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : '対応済みにできませんでした');
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <HandySheet title="お客様の呼び出し" onClose={onClose}>
      {message && (
        <p role="status" className="mb-2 rounded-lg bg-[#efeaf8] p-2 text-[11px] text-[#5e4777]">
          {message}
        </p>
      )}
      {calls.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[#8a769d]">未対応の呼び出しはありません。</p>
      ) : (
        <ul className="space-y-2.5">
          {calls.map((call) => (
            <li key={call.id} className="rounded-[10px] border border-[#e3dbf1] p-3">
              <h3 className="flex items-baseline justify-between text-sm font-bold text-[#4f3868]">
                {call.tableName ?? '—'}
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white',
                    call.kind === 'checkout' ? 'bg-[#bd660f]' : 'bg-[#7b3fe4]'
                  )}
                >
                  {serviceCallLabel(call.kind)}
                </span>
              </h3>
              <p className="my-2 text-[11px] text-[#7a7090]">
                {formatTime(new Date(call.createdAtMs))}　{elapsedLabel(call.createdAtMs, now)}経過
                {call.note ? `　${call.note}` : ''}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleResolve(call)}
                className="min-h-[42px] w-full rounded-[9px] bg-[#7b3fe4] text-sm font-bold text-white disabled:opacity-40"
              >
                {pending && busy === call.id ? '処理中…' : '対応済みにする'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </HandySheet>
  );
}
