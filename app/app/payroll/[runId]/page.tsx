import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Info } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { loadPayrollRunDetail } from '@/lib/payroll-server';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { PayrollDisclaimer } from '@/components/payroll/disclaimer';
import { PayrollItemsTable } from '@/components/payroll/breakdown-panel';
import { BonusItemsTable } from '@/components/payroll/bonus-items-table';
import { RunActions } from '@/components/payroll/run-actions';
import { Payslip } from '@/components/payroll/payslip';
import { RulesSnapshotPanel, type RulesSnapshot } from '@/components/payroll/rules-snapshot-panel';

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

  // 読み込みは lib/payroll-server.ts（iPad ネイティブと同じ）
  const detail = await loadPayrollRunDetail(supabase, ctx, runId, canManage);

  // ---------------------------------------------------------------
  // 本人ビュー
  // ---------------------------------------------------------------
  if (detail.kind === 'self-missing') {
    return (
      <div>
        <PageHeader title="給与明細" />
        <EmptyState title="この給与明細は表示できません" description="対象期間に給与データがないか、確定前のため表示できません" />
      </div>
    );
  }

  if (detail.kind === 'self-not-ready') {
    return (
      <div>
        <PageHeader title="給与明細" />
        <EmptyState title="この給与明細はまだ表示できません" description="確定後に閲覧できるようになります" />
      </div>
    );
  }

  if (detail.kind === 'self') {
    return (
      <div>
        <PageHeader title="給与明細" />
        <PayrollDisclaimer className="mb-4" />
        <Payslip data={detail.payslip} />
      </div>
    );
  }

  // ---------------------------------------------------------------
  // 管理ビュー（payroll.manage）
  // ---------------------------------------------------------------
  if (detail.kind === 'not-found') notFound();
  const { run, runType, storeName, views, bonusViews, nameByProfile } = detail;

  return (
    <div>
      <PageHeader
        title={run.title}
        description={
          runType === 'bonus'
            ? `賞与｜支給日: ${formatDate(run.payment_date)}｜対象: ${storeName ?? '全社'}`
            : `${formatDate(run.period_start)} 〜 ${formatDate(run.period_end)}｜対象: ${storeName ?? '全社'}`
        }
        actions={
          <>
            <Badge tone="navy">{RUN_TYPE_LABEL[runType]}</Badge>
            <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            <Link href={`/app/payroll/${runId}/export`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Download className="h-3.5 w-3.5" />
              CSVエクスポート
            </Link>
            <Link href={`/app/accounting?source_type=payroll&source_id=${runId}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              この給与の仕訳を見る
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

      {run.status === 'approved' && run.rules_snapshot && (
        <div className="mb-4">
          <RulesSnapshotPanel snapshot={run.rules_snapshot as RulesSnapshot} profileNameById={nameByProfile} />
        </div>
      )}

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
