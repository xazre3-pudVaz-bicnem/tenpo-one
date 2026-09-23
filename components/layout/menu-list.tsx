import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { NavIcon } from '@/components/layout/nav-icons';
import { TakeoutRow } from '@/components/layout/takeout-row';
import type { NavGroup, NavItem } from '@/lib/nav';

const menuRowClass = 'flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-navy active:bg-gray-50';

/** メニュー一覧（iPad・スマホ）の行リスト。メニュー画面と集計画面で同じ見た目にする */
export function MenuList({ groups }: { groups: (NavGroup | { label?: null; items: NavItem[] })[] }) {
  return (
    <div className="space-y-5">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">{group.label}</p>
          )}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <ul className="divide-y divide-gray-100">
              {group.items.map((item) => {
                const body = (
                  <>
                    <NavIcon name={item.icon} className="h-5 w-5 shrink-0 text-gray-500" />
                    <span className="flex-1">
                      {item.label}
                      <span className="en-sub">{item.en}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                  </>
                );
                return (
                  <li key={item.href}>
                    {item.action === 'takeout' ? (
                      <TakeoutRow className={menuRowClass}>{body}</TakeoutRow>
                    ) : (
                      <Link href={item.href} className={menuRowClass}>
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
