import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { parseMonthKey } from '@/lib/management-dashboard';
import { loadManagementDashboard } from '@/lib/management-dashboard-server';
import { ManagementView } from '@/components/admin-v2/management-view';

export const metadata: Metadata = { title: '経営ダッシュボード' };

/**
 * 経営ダッシュボード（パソコンの新しい管理画面。2026-10-24 Ronnie「dinii の経営管理のような画面を」）。
 * 月の 売上と予算の達成 ／ 原価率・人件費率・営業利益（目標つき）／ 店舗別 ／ 営業カレンダー。見るだけ。
 * レジ（iPad）のアカウントは今までのホームへ（この画面はパソコン向け）。
 */
export default async function ManagementPage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  const ctx = await requireMember();
  if (ctx.isRegisterDevice) redirect('/app/dashboard');
  if (!can(ctx.role, 'reports.view')) redirect('/app/dashboard');
  const sp = await searchParams;
  const today = todayJst();
  const month = parseMonthKey(sp.month, today);

  const data = await loadManagementDashboard(ctx, { month, today, store: sp.store });
  if (!data) {
    return (
      <div>
        <PageHeader title="経営ダッシュボード" en="Management" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }
  return <ManagementView summary={data.summary} scopeLabel={data.scopeLabel} today={today} storeOverrideId={data.storeOverrideId} costNote={data.costNote} />;
}
