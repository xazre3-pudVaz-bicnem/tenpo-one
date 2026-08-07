import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { visibleNavGroups, MOBILE_NAV } from '@/lib/nav';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { StoreSwitcher } from '@/components/layout/store-switcher';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();

  // 組織に未所属のcypress管理者は運営コンソールへ
  if (!ctx.organizationId) {
    if (ctx.isCypressAdmin) redirect('/admin/organizations');
    redirect('/login?error=no_membership');
  }

  const supabase = await createClient();
  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', ctx.userId)
    .is('read_at', null);

  const groups = visibleNavGroups(ctx.role, ctx.disabledFeatures);
  const mobileItems = MOBILE_NAV.filter((i) => {
    if (i.permission && !can(ctx.role, i.permission)) return false;
    const feature = featureForRoute(i.href);
    return !feature || !ctx.disabledFeatures.has(feature);
  });

  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} />
      <div className="lg:pl-60">
        <TopBar ctx={ctx} unreadCount={unreadCount ?? 0} />
        {/* スマホは店舗切替をヘッダー下に表示 */}
        <div className="border-b border-gray-200 bg-white px-4 py-2 sm:hidden">
          <StoreSwitcher
            stores={ctx.stores}
            currentStoreId={ctx.currentStore?.id ?? null}
            allowAll={ctx.isHq}
          />
        </div>
        <main className="p-4 pb-24 lg:p-6 lg:pb-8">{children}</main>
      </div>
      <MobileNav items={mobileItems} />
    </div>
  );
}
