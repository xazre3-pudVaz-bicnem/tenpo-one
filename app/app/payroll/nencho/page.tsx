import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { NenchoForm, type NenchoStatus } from '@/components/payroll/nencho-form';
import { NenchoAdminPanel, type NenchoAdminRow } from '@/components/payroll/nencho-admin-panel';
import { NenchoStatusFilter } from '@/components/payroll/nencho-status-filter';
import { emptyNenchoData, type NenchoData } from './schema';

export const metadata: Metadata = { title: '年末調整' };

const ADMIN_STATUSES = ['submitted', 'reviewing', 'needs_fix', 'confirmed'];

function currentJstYear(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' }));
}

export default async function NenchoPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('payroll');
  const canReview = can(ctx.role, 'payroll.view_all');
  const year = sp.year && Number.isFinite(Number(sp.year)) ? Number(sp.year) : currentJstYear();
  const supabase = await createClient();

  const { data: own } = await supabase
    .from('nencho_declarations')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('year', year)
    .maybeSingle();

  const ownStatus: NenchoStatus = (own?.status as NenchoStatus) ?? 'new';
  const ownData: NenchoData = (own?.data as NenchoData) ?? emptyNenchoData();

  let adminRows: NenchoAdminRow[] = [];
  if (canReview) {
    let query = supabase
      .from('nencho_declarations')
      .select('id, year, status, submitted_at, reviewed_at, review_note, data, profiles(display_name)')
      .eq('organization_id', ctx.organizationId)
      .eq('year', year)
      .neq('status', 'draft')
      .order('submitted_at', { ascending: false });
    if (sp.status && ADMIN_STATUSES.includes(sp.status)) {
      query = query.eq('status', sp.status);
    }
    const { data } = await query;
    adminRows = (data ?? []).map((row) => {
      const profile = row.profiles as unknown as { display_name: string } | null;
      return {
        id: row.id as string,
        profileName: profile?.display_name ?? '不明',
        year: row.year as number,
        status: row.status as NenchoAdminRow['status'],
        submittedAt: row.submitted_at as string | null,
        reviewedAt: row.reviewed_at as string | null,
        reviewNote: row.review_note as string | null,
        data: row.data as NenchoData,
      };
    });
  }

  const yearOptions = [year - 1, year, year + 1];

  return (
    <div>
      <Link href="/app/payroll" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ChevronLeft className="h-4 w-4" />
        給与・歩合へ戻る
      </Link>
      <PageHeader title="年末調整" description="年末調整の申告情報を収集・確認するワークフローです" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">対象年</span>
        {yearOptions.map((y) => (
          <Link
            key={y}
            href={`/app/payroll/nencho?year=${y}`}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              y === year ? 'border-navy bg-navy text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            {y}年
          </Link>
        ))}
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy">自分の申告</h2>
          <NenchoForm year={year} initial={ownData} status={ownStatus} reviewNote={own?.review_note ?? null} />
        </section>

        {canReview && (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-navy">提出状況の確認（管理）</h2>
              <NenchoStatusFilter year={year} current={sp.status ?? ''} />
            </div>
            {adminRows.length === 0 ? (
              <EmptyState title="該当する申告はありません" />
            ) : (
              <NenchoAdminPanel rows={adminRows} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
