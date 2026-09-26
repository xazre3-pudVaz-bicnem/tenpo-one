'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Store, Building2, Clock, UtensilsCrossed, ListPlus, UserRound, ChartColumn, Printer, QrCode, LayoutGrid,
  CalendarClock, Users, CreditCard, Percent, BookOpen, ShieldCheck, Gift, TriangleAlert, Upload, Plug,
  ScrollText, ChevronRight, Smartphone, ClipboardList, Tags, BookOpenText, Sheet, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RegisterReturnBar } from './register-return-bar';

const ICONS = {
  store: Store,
  company: Building2,
  hours: Clock,
  menu: UtensilsCrossed,
  options: ListPlus,
  plans: ClipboardList,
  categories: Tags,
  menubook: BookOpenText,
  bulk: Sheet,
  dynamic: TrendingUp,
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
  /**
   * この項目の中に入れる画面（2026-09-27 Ronnie「プラン・オプション・カテゴリ…は全部メニューの中に」）。
   * 左メニューには親だけを出し、親か子を開いているときは画面の上に親＋子のタブを出す。
   */
  children?: SettingsNavItem[];
  /**
   * true なら自分の画面を持たない「まとめ」（店舗・デバイス管理…）。href は最初の子の画面で、
   * 上のタブには子だけを並べる（2026-09-27 Ronnie「設定は全部メニューみたいにまとめてきれいに」）。
   */
  hub?: boolean;
}

export interface SettingsNavGroup {
  /** 空なら見出しを出さない */
  label: string;
  en: string;
  items: SettingsNavItem[];
}

/** 設定の基点パス */
const HUB = '/app/settings';
/** 設定の2ペイン枠を付けない画面（印刷専用など） */
const BARE_PREFIXES = ['/app/settings/printers/test-print'];

function isSelf(pathname: string, item: SettingsNavItem) {
  if (item.matchActive === false) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

/** 自分か、自分の中の画面（children）を開いているか（まとめは子で判定する） */
function isActive(pathname: string, item: SettingsNavItem): boolean {
  if (item.hub) return item.children?.some((c) => isActive(pathname, c)) ?? false;
  return isSelf(pathname, item) || (item.children?.some((c) => isActive(pathname, c)) ?? false);
}

/** 親＋子のタブ（メニュー／プラン／オプション…）。親か子の画面の上に出す */
export function SettingsSubTabs({ item, pathname }: { item: SettingsNavItem; pathname: string }) {
  const kids = item.children ?? [];
  const childOn = kids.some((c) => isActive(pathname, c));
  const tabs = [
    ...(item.hub ? [] : [{ ...item, on: !childOn && isSelf(pathname, item) }]),
    ...kids.map((c) => ({ ...c, on: isActive(pathname, c) })),
  ];
  return (
    <nav aria-label={`${item.label}の設定`} className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-white p-1.5 [scrollbar-width:none]">
      {tabs.map((t) => {
        const Icon = ICONS[t.icon];
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.on ? 'page' : undefined}
            className={cn(
              'tap3d flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-left leading-tight whitespace-nowrap',
              t.on ? 'on-brand text-white' : 'bg-white text-ink-2 hover:bg-lilac-soft'
            )}
          >
            <Icon className={cn('h-[18px] w-[18px] shrink-0', t.on ? 'text-white' : 'text-saffron')} aria-hidden />
            <span>
              <span className="block text-[14px] font-bold">{t.label}</span>
              <span className={cn('block font-num text-[10.5px] font-semibold', t.on ? 'text-white/80' : 'text-ink-3')}>{t.en}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** 設定メニュー（左ペイン）。スマホの設定トップでは全幅の一覧として使い、説明文も表示する。 */
export function SettingsNav({ groups, pathname }: { groups: SettingsNavGroup[]; pathname: string }) {
  return (
    <nav aria-label="設定メニュー" className="py-1.5 lg:py-1">
      {groups.map((g, gi) => (
        <div key={`${gi}-${g.label}`}>
          {g.label && (
            <p className="px-[18px] pb-1 pt-2.5 text-[11px] font-bold tracking-[0.04em] text-ink-3">
              {g.label}
              <span className="mx-1 font-normal text-wisteria">／</span>
              <span className="font-num">{g.en}</span>
            </p>
          )}
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
                      // パソコンの左ペインは 1 行（2026-09-28 Ronnie「もっとスリムに」）。スマホの設定トップは説明つきの一覧
                      'flex min-h-[52px] items-center gap-2.5 px-[18px] py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-lilac-soft lg:min-h-[40px] lg:px-3.5 lg:py-1.5',
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
                      <span className="block truncate">
                        {item.label}
                        <span className="en-inline hidden text-[10.5px] lg:inline">{item.en}</span>
                      </span>
                      <span className="en-sub lg:hidden">{item.en}</span>
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
  // 中に画面を持つ項目（メニュー）を開いているときは、画面の上に親＋子のタブを出す
  const parent = groups.flatMap((g) => g.items).find((i) => i.children?.length && isActive(pathname, i));

  return (
    <div className="flex flex-col gap-4">
      <div className={cn('print:hidden', !isHub && 'hidden lg:block')}>
        <h1 className="text-xl font-bold leading-snug text-ink">
          設定<span className="en-inline text-xs">Settings</span>
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-3">店舗・メニュー・機器・スタッフの設定（オーナー・店長のみ変更可）</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[228px_minmax(0,1fr)]">
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
          {parent && <SettingsSubTabs item={parent} pathname={pathname} />}
          {children}
        </div>
      </div>
    </div>
  );
}
