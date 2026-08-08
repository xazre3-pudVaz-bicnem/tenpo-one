'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/admin/organizations', label: '企業' },
  { href: '/admin/stores', label: '店舗' },
  { href: '/admin/users', label: 'ユーザー' },
  { href: '/admin/plans', label: 'プラン' },
  { href: '/admin/feature-flags', label: '機能フラグ' },
  { href: '/admin/legal-rules', label: '法定ルール' },
  { href: '/admin/support', label: 'サポート' },
  { href: '/admin/audit-logs', label: '監査ログ' },
  { href: '/admin/status', label: '状態' },
];

/** CYPRESS運営管理コンソールの水平ナビゲーション。モバイルは横スクロール。 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-t border-white/10 px-4 sm:px-6"
      aria-label="運営管理ナビゲーション"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-primary text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
