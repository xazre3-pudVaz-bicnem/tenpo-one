'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { NavGroup } from '@/lib/nav';
import { NavIcon } from './nav-icons';
import { BrandLogo } from './brand-logo';

/** PC用左サイドバー（濃紺） */
export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/app/dashboard" aria-label="ダッシュボードへ">
          <BrandLogo className="text-lg" light />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="メインナビゲーション">
        {groups.map((group, gi) => (
          <div key={gi} className="mt-4 first:mt-1">
            {group.label && (
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === '/app/reservations'
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
