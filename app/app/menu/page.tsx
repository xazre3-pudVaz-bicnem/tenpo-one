import type { Metadata } from 'next';
import Link from 'next/link';
import { LogOut, ChevronRight } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { visibleNavGroups } from '@/lib/nav';
import { ROLE_LABELS } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { NavIcon } from '@/components/layout/nav-icons';
import { signOut } from '@/app/app/actions';

export const metadata: Metadata = { title: 'メニュー' };

export default async function MenuPage() {
  const ctx = await requireMember();
  const groups = visibleNavGroups(ctx.role);

  return (
    <div>
      <PageHeader title="メニュー" />

      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 py-4">
        <p className="text-sm font-semibold text-navy">{ctx.displayName}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {ROLE_LABELS[ctx.role]}
          {ctx.organizationName ? `｜${ctx.organizationName}` : ''}
        </p>
      </div>

      <div className="space-y-5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                {group.label}
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <ul className="divide-y divide-gray-100">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-navy active:bg-gray-50"
                    >
                      <NavIcon name={item.icon} className="h-5 w-5 shrink-0 text-gray-500" />
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-danger active:bg-gray-50"
        >
          <LogOut className="h-4 w-4" />
          ログアウト
        </button>
      </form>
    </div>
  );
}
