import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Info } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { PayrollDisclaimer } from '@/components/payroll/disclaimer';
import { PayrollItemsTable, type PayrollItemView } from '@/components/payroll/breakdown-panel';
import { RunActions } from '@/components/payroll/run-actions';

export const metadata: Metadata = { title: '給与計算 詳細' };

const RUN_STATUS_LABEL: Record<string, string> = { draft: '下書き', confirmed: '確定済み', approved: '承認済み' };
const RUN_STATUS_TONE: Record<string, 'gray' | 'warning' | 'success'> = {
  draft: 'gray',
  confirmed: 'warning',
  approved: 'success',
};

export default async function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();

  const { data: run } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!run) notFound();

  const { data: storeRow } = run.store_id
    ? await supabase.from('stores').select('name').eq('id', run.store_id).maybeSingle()
    : { data: null };

  const { data: items } = await supabase
    .from('payroll_items')
    .select('*, profiles(display_name)')
    .eq('payroll_run_id', runId)
    .order('created_at');

  const views: PayrollItemView[] = (items ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    return {
      id: row.id,
      profileName: profile?.display_name ?? '不明',
      workDays: row.work_days,
      workMinutes: row.work_minutes,
      overtimeMinutes: row.overtime_minutes,
      nightMinutes: row.night_minutes,
      basePay: row.base_pay,
      overtimePay: row.overtime_pay,
      nightPay: row.night_pay,
      holidayPay: row.holiday_pay,
      commutePay: row.commute_pay,
      allowanceTotal: row.allowance_total,
      commissionTotal: row.commission_total,
      grossTotal: row.gross_total,
      breakdown: row.breakdown as PayrollItemView['breakdown'],
    };
  });

  return (
    <div>
      <PageHeader
        title={run.title}
        description={`${formatDate(run.period_start)} 〜 ${formatDate(run.period_end)}｜対象: ${storeRow?.name ?? '全社'}`}
        actions={
          <>
            <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            <Link href={`/app/payroll/${runId}/export`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Download className="h-3.5 w-3.5" />
              CSVエクスポート
            </Link>
          </>
        }
      />
      <PayrollDisclaimer className="mb-4" />

      {run.note && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{run.note}</p>
        </div>
      )}

      <div className="mb-4">
        <RunActions runId={runId} status={run.status} />
      </div>

      {views.length === 0 ? (
        <EmptyState title="この期間の対象者がいません" description="給与ルールが未設定か、勤怠記録がありません" />
      ) : (
        <PayrollItemsTable items={views} />
      )}
    </div>
  );
}
