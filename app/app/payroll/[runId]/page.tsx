import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Info } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { PayrollDisclaimer } from '@/components/payroll/disclaimer';
import { PayrollItemsTable, type PayrollItemView } from '@/components/payroll/breakdown-panel';
import { BonusItemsTable, type BonusItemView } from '@/components/payroll/bonus-items-table';
import { RunActions } from '@/components/payroll/run-actions';
import { Payslip, type PayslipData } from '@/components/payroll/payslip';

export const metadata: Metadata = { title: '給与計算 詳細' };

const RUN_STATUS_LABEL: Record<string, string> = { draft: '下書き', confirmed: '確定済み', approved: '承認済み' };
const RUN_STATUS_TONE: Record<string, 'gray' | 'warning' | 'success'> = {
  draft: 'gray',
  confirmed: 'warning',
  approved: 'success',
};
const RUN_TYPE_LABEL: Record<string, string> = { salary: '給与', bonus: '賞与' };

export default async function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  // 管理者は全明細を、一般スタッフは自分の明細のみ閲覧できる
  const ctx = await requireFeature('payroll');
  const canManage = can(ctx.role, 'payroll.manage');
  const supabase = await createClient();

  // ---------------------------------------------------------------
  // 本人ビュー: payroll_runs は payroll.view_all ロールのみが読める RLS のため、
  // 先に本人所有の payroll_items（RLS: profile_id = auth.uid()）で権限を確認してから、
  // admin client で run の表示用フィールド（非機密）のみを取得する。
  // ---------------------------------------------------------------
  if (!canManage) {
    const { data: item } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('payroll_run_id', runId)
      .eq('organization_id', ctx.organizationId)
      .eq('profile_id', ctx.userId)
      .maybeSingle();

    if (!item) {
      return (
        <div>
          <PageHeader title="給与明細" />
          <EmptyState title="この給与明細は表示できません" description="対象期間に給与データがないか、確定前のため表示できません" />
        </div>
      );
    }

    const admin = createAdminClient();
    const { data: run } = await admin
      .from('payroll_runs')
      .select('id, title, run_type, period_start, period_end, payment_date, status')
      .eq('id', runId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (!run || (run.status !== 'confirmed' && run.status !== 'approved')) {
      return (
        <div>
          <PageHeader title="給与明細" />
          <EmptyState title="この給与明細はまだ表示できません" description="確定後に閲覧できるようになります" />
        </div>
      );
    }

    const runType = (run.run_type ?? 'salary') as 'salary' | 'bonus';
    const payslipData: PayslipData = {
      runTitle: run.title,
      runType,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      paymentDate: run.payment_date,
      profileName: ctx.displayName,
      organizationName: ctx.organizationName,
      workDays: item.work_days,
      workMinutes: item.work_minutes,
      overtimeMinutes: item.overtime_minutes,
      nightMinutes: item.night_minutes,
      holidayMinutes: item.holiday_minutes,
      basePay: item.base_pay,
      overtimePay: item.overtime_pay,
      nightPay: item.night_pay,
      holidayPay: item.holiday_pay,
      commutePay: item.commute_pay,
      allowanceTotal: item.allowance_total,
      commissionTotal: item.commission_total,
      grossTotal: item.gross_total,
    };

    return (
      <div>
        <PageHeader title="給与明細" />
        <PayrollDisclaimer className="mb-4" />
        <Payslip data={payslipData} />
      </div>
    );
  }

  // ---------------------------------------------------------------
  // 管理ビュー（payroll.manage）
  // ---------------------------------------------------------------
  const { data: run } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', runId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!run) notFound();

  const runType = (run.run_type ?? 'salary') as 'salary' | 'bonus';

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
      holidayMinutes: row.holiday_minutes,
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

  const bonusViews: BonusItemView[] = (items ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    return { id: row.id, profileName: profile?.display_name ?? '不明', amount: row.gross_total };
  });

  return (
    <div>
      <PageHeader
        title={run.title}
        description={
          runType === 'bonus'
            ? `賞与｜支給日: ${formatDate(run.payment_date)}｜対象: ${storeRow?.name ?? '全社'}`
            : `${formatDate(run.period_start)} 〜 ${formatDate(run.period_end)}｜対象: ${storeRow?.name ?? '全社'}`
        }
        actions={
          <>
            <Badge tone="navy">{RUN_TYPE_LABEL[runType]}</Badge>
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
        <RunActions runId={runId} status={run.status} runType={runType} />
      </div>

      {runType === 'bonus' ? (
        bonusViews.length === 0 ? (
          <EmptyState title="支給対象者がいません" />
        ) : (
          <BonusItemsTable items={bonusViews} />
        )
      ) : views.length === 0 ? (
        <EmptyState title="この期間の対象者がいません" description="給与ルールが未設定か、勤怠記録がありません" />
      ) : (
        <PayrollItemsTable items={views} />
      )}
    </div>
  );
}
