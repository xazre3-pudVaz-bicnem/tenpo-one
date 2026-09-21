'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Store, Building2, Clock, UtensilsCrossed, ListPlus, UserRound, ChartColumn, Printer, QrCode, LayoutGrid,
  CalendarClock, Users, CreditCard, Percent, BookOpen, ShieldCheck, Gift, TriangleAlert, Upload, Plug,
  ScrollText, ChevronRight, Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RegisterReturnBar } from './register-return-bar';

const ICONS = {
  store: Store,
  company: Building2,
  hours: Clock,
  menu: UtensilsCrossed,
  options: ListPlus,
  clerks: UserRound,
  reports: ChartColumn,
  printers: Printer,
  handy: Smartphone,
  qr: QrCode,
  tables: LayoutGrid,
  booking: CalendarClock,
  staff: Users,
  payments: CreditCard,
  tax: Percent,
  accounts: BookOpen,
  approvals: ShieldCheck,
  loyalty: Gift,
  alerts: TriangleAlert,
  import: Upload,
  integrations: Plug,
  audit: ScrollText,
} as const;

export type SettingsIconKey = keyof typeof ICONS;

export interface SettingsNavItem {
  href: string;
  label: string;
  en: string;
  description: string;
  icon: SettingsIconKey;
  /** false のときは現在地として強調しない（同じ画面への別名リンク・設定外の画面） */
  matchActive?: boolean;
  /** true なら同じパスのときだけ選択中にする（下の階層に別のメニューがあるとき） */
  exact?: boolean;
  /** 設定トップ（PC）で右ペインに概要を出している項目として強調する */
  hubDefault?: boolean;
}

export interface SettingsNavGroup {
  label: string;
  en: string;
  items: SettingsNavItem[];
}

/** 設定の基点パス */
const HUB = '/app/settings';
/** 設定の2ペイン枠を付けない画面（印刷専用など） */
const BARE_PREFIXES = ['/app/settings/printers/test-print'];

function isActive(pathname: string, item: SettingsNavItem) {
  if (item.matchActive === false) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

/** 設定メニュー（左ペイン）。スマホの設定トップでは全幅の一覧として使い、説明文も表示する。 */
export function SettingsNav({ groups, pathname }: { groups: SettingsNavGroup[]; pathname: string }) {
  return (
    <nav aria-label="設定メニュー" className="py-1.5">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-[18px] pb-1 pt-2.5 text-[11px] font-bold tracking-[0.04em] text-ink-3">
            {g.label}
            <span className="mx-1 font-normal text-wisteria">／</span>
            <span className="font-num">{g.en}</span>
          </p>
          <ul>
            {g.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item);
              // 設定トップでは PC のみ「店舗情報」を選択中として見せる（右ペインが店舗情報の概要のため）
              const hubActive = !active && pathname === HUB && item.hubDefault === true;
              return (
                <li key={`${item.href}-${item.label}`}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[52px] items-center gap-2.5 px-[18px] py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-lilac-soft',
                      active && 'bg-iris-soft font-bold text-royal hover:bg-iris-soft',
                      hubActive && 'lg:bg-iris-soft lg:font-bold lg:text-royal lg:hover:bg-iris-soft'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-[18px] w-[18px] shrink-0',
                        active ? 'text-royal' : 'text-saffron',
                        hubActive && 'lg:text-royal'
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block">{item.label}</span>
                      <span className="en-sub">{item.en}</span>
                      <span className="mt-0.5 block text-xs font-normal text-ink-3 lg:hidden">{item.description}</span>
                    </span>
                    <ChevronRight
                      className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-royal' : 'text-wisteria', hubActive && 'lg:text-royal')}
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * 設定画面の枠（プロトタイプの .settings）。
 * PC: 見出し＋左メニュー(270px)＋右に各設定。スマホ: 設定トップはメニュー一覧のみ、各設定は右ペインのみ。
 */
export function SettingsShell({ groups, children }: { groups: SettingsNavGroup[]; children: React.ReactNode }) {
  const pathname = usePathname() ?? HUB;
  if (BARE_PREFIXES.some((p) => pathname.startsWith(p))) return <>{children}</>;
  const isHub = pathname === HUB;

  return (
    <div className="flex flex-col gap-4">
      <div className={cn('print:hidden', !isHub && 'hidden lg:block')}>
        <h1 className="text-xl font-bold leading-snug text-ink">
          設定<span className="en-inline text-xs">Settings</span>
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-3">店舗・メニュー・機器・スタッフの設定（オーナー・店長のみ変更可）</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className={cn('print:hidden', isHub ? 'block' : 'hidden lg:block')}>
          <div className="ui-card overflow-hidden border border-line bg-white">
            <SettingsNav groups={groups} pathname={pathname} />
          </div>
        </aside>
        <div className={cn('@container min-w-0', isHub && 'hidden lg:block')}>
          {/* レジの設定から開いたときだけ「レジの設定に戻る」を出す */}
          <Suspense fallback={null}>
            <RegisterReturnBar />
          </Suspense>
          {children}
        </div>
      </div>
    </div>
  );
}
