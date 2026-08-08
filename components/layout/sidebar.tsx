'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/nav';
import { NavIcon } from './nav-icons';
import { BrandLogo } from './brand-logo';

const STORAGE_KEY = 'tenpo-nav-collapsed';

function isItemActive(pathname: string, href: string): boolean {
  if (href === '/app/reservations' || href === '/app/accounting') {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * PC用左サイドバー（濃紺）。
 * 機能増加に伴いグループを折りたたみ可能にし、現在地のグループは自動展開する。
 * 折りたたみ状態は localStorage に保持。
 */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // SSRとのhydration不一致を避けるためマウント後に復元する
    // （effect本体での同期setStateを避けるためタスクへ遅延）
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setCollapsed(JSON.parse(raw));
      } catch {
        // 破損した保存値は無視
      }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const toggle = (label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage不可環境では永続化しない
      }
      return next;
    });
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy lg:flex">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/app/dashboard" aria-label="ダッシュボードへ">
          <BrandLogo className="text-lg" light />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="メインナビゲーション">
        {groups.map((group, gi) => {
          const hasActive = group.items.some((i) => isItemActive(pathname, i.href));
          // 現在地を含むグループは折りたたみ設定に関わらず展開する
          const isCollapsed = loaded && group.label ? (collapsed[group.label] ?? false) && !hasActive : false;

          return (
            <div key={group.label ?? gi} className="mt-3 first:mt-1">
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggle(group.label!)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between rounded px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-300"
                >
                  {group.label}
                  <ChevronDown
                    className={cn('h-3 w-3 transition-transform', isCollapsed && '-rotate-90')}
                  />
                </button>
              )}
              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isItemActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors',
                            active
                              ? 'bg-primary text-white'
                              : 'text-gray-300 hover:bg-navy-soft hover:text-white'
                          )}
                        >
                          <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
