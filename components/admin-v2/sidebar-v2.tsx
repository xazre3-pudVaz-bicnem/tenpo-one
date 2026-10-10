'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavIcon } from '@/components/layout/nav-icons';
import { TakeoutRow } from '@/components/layout/takeout-row';
import { useToast } from '@/components/ui/toast';
import { enqueueDrawerKick } from '@/app/app/pos/print-actions';
import { V2_STAFF_LINK, V2_TOP_LINKS, linkPath, v2OpenKeysForPath, type V2Link, type V2Section } from '@/lib/admin-v2';

const STORAGE_KEY = 'tenpo-nav-v2-open';

const topRow =
  'flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium text-ink-2 hover:bg-lilac-soft hover:text-royal aria-[current=page]:bg-iris-soft aria-[current=page]:font-bold aria-[current=page]:text-royal';
const groupRow =
  'flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] font-medium text-ink-2 hover:bg-lilac-soft hover:text-royal';
const subRow =
  'block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-lilac-soft hover:text-royal aria-[current=page]:bg-iris-soft aria-[current=page]:font-bold aria-[current=page]:text-royal';

/** 左メニュー：リンクの場所が今の画面か（? や # が付くリンクは選択表示しない） */
function isCurrent(pathname: string, href: string): boolean {
  if (href.startsWith('#') || href.includes('?') || href.includes('#')) return false;
  return pathname === linkPath(href);
}

/**
 * 新しい管理画面（パソコン）の左メニュー（2026-10-10 Ronnie）。
 * ▼ を押すとグループが開く・閉じる。開いた状態はこのブラウザに覚えておく。今の画面のグループは最初から開く。
 * レジ（iPad）・ハンディでは使わない（app/app/layout.tsx・lib/admin-v2.ts）。
 */
export function SidebarV2({
  sections,
  showStaff,
  currentStoreId,
  footer,
}: {
  sections: V2Section[];
  showStaff: boolean;
  currentStoreId: string | null;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // SSR と同じ見た目で描いてから、覚えておいた開閉を戻す（effect 内の同期 setState を避けてタスクへ）
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setSaved(JSON.parse(raw));
      } catch {
        // 壊れた保存値・storage 不可は無視
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // 注文画面（/app/pos）は画面の幅を全部使う（今の左メニューと同じ）
  if (pathname === '/app/pos') return null;

  const activeKeys = v2OpenKeysForPath(pathname, sections);
  const isOpen = (key: string) => saved[key] ?? activeKeys.includes(key);
  const toggle = (key: string) => {
    setSaved((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? activeKeys.includes(key)) };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage 不可なら覚えない
      }
      return next;
    });
  };

  return (
    <aside
      className="fixed top-[58px] bottom-0 left-0 z-30 hidden w-[250px] flex-col border-r border-line bg-white lg:flex"
      aria-label="管理メニュー"
    >
      <nav className="flex-1 overflow-y-auto px-3 pt-4 pb-6">
        <ul className="space-y-0.5">
          {V2_TOP_LINKS.map((l) => {
            const current = l.href === '/app/dashboard' ? pathname === l.href : pathname === l.href || pathname.startsWith(l.href + '/');
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={current ? 'page' : undefined} className={topRow}>
                  <NavIcon name={l.icon} className="h-[18px] w-[18px] shrink-0" />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {sections.map((section, si) => (
          <div key={section.label ?? `s${si}`}>
            {section.label && (
              <div className="px-2.5 pt-4 pb-1 text-[11px] font-bold tracking-[0.08em] text-ink-3">{section.label}</div>
            )}
            <ul className="space-y-0.5">
              {section.groups.map((g) => {
                const open = isOpen(g.key);
                const hasActive = activeKeys.includes(g.key);
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggle(g.key)}
                      aria-expanded={open}
                      className={cn(groupRow, hasActive && 'font-bold text-royal')}
                    >
                      <NavIcon name={g.icon} className="h-[18px] w-[18px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{g.label}</span>
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-3 transition-transform', !open && '-rotate-90')} />
                    </button>
                    {open && (
                      <ul className="mb-1.5 ml-[18px] flex flex-col gap-px border-l-2 border-lilac pl-3">
                        {g.links.map((l) => (
                          <li key={l.href + l.label}>
                            <SubLink link={l} pathname={pathname} storeId={currentStoreId} />
                          </li>
                        ))}
                        {g.nested && (
                          <li>
                            <button
                              type="button"
                              onClick={() => toggle(g.nested!.key)}
                              aria-expanded={isOpen(g.nested.key)}
                              className={cn(subRow, 'flex items-center gap-1.5')}
                            >
                              <span className="flex-1">{g.nested.label}</span>
                              <ChevronDown
                                className={cn('h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform', !isOpen(g.nested.key) && '-rotate-90')}
                              />
                            </button>
                            {isOpen(g.nested.key) && (
                              <ul className="mb-1.5 ml-2.5 flex flex-col gap-px border-l-2 border-lilac pl-2.5">
                                {g.nested.links.map((l) => (
                                  <li key={l.href + l.label}>
                                    <SubLink link={l} pathname={pathname} storeId={currentStoreId} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
              {section.label === '設定' && showStaff && (
                <li>
                  <Link
                    href={V2_STAFF_LINK.href}
                    aria-current={pathname.startsWith(V2_STAFF_LINK.href) ? 'page' : undefined}
                    className={topRow}
                  >
                    <NavIcon name={V2_STAFF_LINK.icon} className="h-[18px] w-[18px] shrink-0" />
                    {V2_STAFF_LINK.label}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        ))}

        {footer && <div className="mt-5">{footer}</div>}
      </nav>
    </aside>
  );
}

function SubLink({ link, pathname, storeId }: { link: V2Link; pathname: string; storeId: string | null }) {
  if (link.action === 'takeout') {
    return <TakeoutRow className={cn(subRow, 'disabled:opacity-50')}>{link.label}</TakeoutRow>;
  }
  if (link.action === 'drawer') {
    return <DrawerButton label={link.label} storeId={storeId} />;
  }
  return (
    <Link href={link.href} aria-current={isCurrent(pathname, link.href) ? 'page' : undefined} className={subRow}>
      {link.label}
    </Link>
  );
}

/** ドロアオープン（レシートプリンタ経由でキャッシュドロアを開く。今の左メニューと同じ動き） */
function DrawerButton({ label, storeId }: { label: string; storeId: string | null }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={cn(subRow, 'disabled:opacity-50')}
      disabled={pending || !storeId}
      title={storeId ? undefined : '店舗を選択してください'}
      onClick={() =>
        startTransition(async () => {
          if (!storeId) return;
          const res = await enqueueDrawerKick(storeId);
          if (res.ok) toast('ドロアを開きます');
          else toast(res.error ?? 'ドロアを開けませんでした', 'error');
        })
      }
    >
      {label}
    </button>
  );
}
