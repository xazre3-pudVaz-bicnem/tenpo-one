import type { Metadata } from 'next';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { NavIcon } from '@/components/layout/nav-icons';
import { MenuList } from '@/components/layout/menu-list';
import { signOut } from '@/app/app/actions';
import { menuLayout } from './data';

export const metadata: Metadata = { title: 'メニュー' };

export default async function MenuPage() {
  const ctx = await requireMember();
  const { tiles, main } = menuLayout(ctx.role, ctx.disabledFeatures);

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

      {tiles.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-4 text-royal shadow-card active:bg-iris-soft"
            >
              <span className="min-w-0">
                <span className="block text-base font-bold">{t.label}</span>
                <span className="block text-xs text-ink-3">{t.en}</span>
              </span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-iris-soft text-iris">
                <NavIcon name={t.icon} className="h-5 w-5" />
              </span>
            </Link>
          ))}
        </div>
      )}

      <MenuList groups={[{ items: main }]} />

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
