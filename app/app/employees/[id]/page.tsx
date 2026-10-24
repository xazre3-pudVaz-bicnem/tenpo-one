import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { loadEmployeeDetail } from '@/lib/employees-server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { BasicInfoForm } from '@/components/employees/basic-info-form';
import { ConfidentialForm } from '@/components/employees/confidential-form';
import { InsuranceForm } from '@/components/employees/insurance-form';
import { EMPLOYMENT_TYPE_LABELS } from '../constants';

export const metadata: Metadata = { title: '従業員詳細' };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireFeature('payroll');
  const supabase = await createClient();

  // 読み込み・見られる人の分け方は lib/employees-server.ts（iPad のネイティブと同じ）
  const detail = await loadEmployeeDetail(ctx, supabase, id);

  if (detail.kind === 'notFound') {
    return (
      <div>
        <EmptyState
          title="従業員情報が見つかりません"
          action={
            detail.canViewList && (
              <Link href="/app/employees" className="text-sm font-medium text-primary hover:underline">
                従業員台帳へ戻る
              </Link>
            )
          }
        />
      </div>
    );
  }

  if (detail.kind === 'forbidden') {
    return (
      <div>
        <PageHeader title="従業員詳細" />
        <EmptyState title="閲覧権限がありません" description="この従業員情報の閲覧には権限が必要です。管理者にお問い合わせください。" />
      </div>
    );
  }

  const { canViewList, canEdit, displayName } = detail;
  const basicInitial = detail.basic;
  const confidentialInitial = detail.confidential;
  const insuranceInitial = detail.insurance;

  return (
    <div>
      {canViewList && (
        <Link href="/app/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
          <ChevronLeft className="h-4 w-4" />
          従業員台帳へ戻る
        </Link>
      )}
      <PageHeader
        title={displayName}
        description={`${EMPLOYMENT_TYPE_LABELS[detail.employmentType] ?? detail.employmentType}｜所属店舗: ${detail.storeName ?? '未設定'}｜入社日: ${formatDate(detail.hiredOn)}`}
      />

      <div className="space-y-5">
        <BasicInfoForm initial={basicInitial} stores={ctx.stores} canEdit={canEdit} />
        {confidentialInitial && <ConfidentialForm initial={confidentialInitial} canEdit={canEdit} />}
        {insuranceInitial && <InsuranceForm initial={insuranceInitial} canEdit={canEdit} />}
      </div>
    </div>
  );
}
