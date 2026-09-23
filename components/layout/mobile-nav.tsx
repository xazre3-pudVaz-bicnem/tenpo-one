'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/lib/nav';
import { NavIcon } from './nav-icons';

/**
 * スマホ・タブレット用の下部ナビゲーション。
 * パソコン（マウス）だけ左メニューに切り替える。iPad は横向きで幅が 1024px を超えるため、
 * 幅ではなく指で使う端末か（pointer: coarse）で見分ける。alwaysShow はレジ端末用。
 */
export function MobileNav({ items, alwaysShow = false }: { items: NavItem[]; alwaysShow?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]',
        !alwaysShow && 'lg:pointer-fine:hidden'
      )}
      aria-label="モバイルナビゲーション"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
                  active ? 'text-primary' : 'text-gray-500'
                )}
              >
                <NavIcon name={item.icon} className="h-5 w-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
