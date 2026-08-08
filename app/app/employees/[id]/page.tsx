import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { BasicInfoForm, type EmployeeBasicData } from '@/components/employees/basic-info-form';
import { ConfidentialForm, type ConfidentialData } from '@/components/employees/confidential-form';
import { InsuranceForm, type InsuranceData } from '@/components/employees/insurance-form';
import { EMPLOYMENT_TYPE_LABELS } from '../constants';

export const metadata: Metadata = { title: '従業員詳細' };

interface EmployeeDetailRow {
  id: string;
  profile_id: string;
  employee_no: string | null;
  legal_name: string | null;
  legal_name_kana: string | null;
  postal_code: string | null;
  address: string | null;
  birth_date: string | null;
  hired_on: string | null;
  terminated_on: string | null;
  employment_type: string;
  position: string | null;
  primary_store_id: string | null;
  status: string;
  bank_transfer_info: { bank?: string; branch?: string; type?: string; last4?: string; holder?: string } | null;
  emergency_contact: { name?: string; relation?: string; phone?: string } | null;
  profiles: { display_name: string } | null;
  stores: { name: string } | null;
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireFeature('payroll');
  const supabase = await createClient();

  const canViewList = can(ctx.role, 'staff.manage');
  // employees_write / employee_insurance_write RLS（org_owner/hq_admin/hq_accounting）と揃える
  const canEdit = can(ctx.role, 'payroll.manage');
  const canViewConfidential = can(ctx.role, 'payroll.view_all');

  const baseColumns =
    'id, profile_id, employee_no, legal_name, legal_name_kana, postal_code, address, birth_date, hired_on, terminated_on, employment_type, position, primary_store_id, status, profiles(display_name), stores(name)';
  const columns = canViewConfidential ? `${baseColumns}, bank_transfer_info, emergency_contact` : baseColumns;

  const { data } = await supabase.from('employees').select(columns).eq('id', id).eq('organization_id', ctx.organizationId).maybeSingle();
  const employee = data as unknown as EmployeeDetailRow | null;

  if (!employee) {
    return (
      <div>
        <EmptyState
          title="従業員情報が見つかりません"
          action={
            canViewList && (
              <Link href="/app/employees" className="text-sm font-medium text-primary hover:underline">
                従業員台帳へ戻る
              </Link>
            )
          }
        />
      </div>
    );
  }

  const isSelf = employee.profile_id === ctx.userId;
  if (!canViewList && !isSelf) {
    return (
      <div>
        <PageHeader title="従業員詳細" />
        <EmptyState title="閲覧権限がありません" description="この従業員情報の閲覧には権限が必要です。管理者にお問い合わせください。" />
      </div>
    );
  }

  const displayName = employee.legal_name || employee.profiles?.display_name || '—';

  const basicInitial: EmployeeBasicData = {
    id: employee.id,
    employeeNo: employee.employee_no ?? '',
    legalName: employee.legal_name ?? '',
    legalNameKana: employee.legal_name_kana ?? '',
    postalCode: employee.postal_code ?? '',
    address: employee.address ?? '',
    birthDate: employee.birth_date ?? '',
    hiredOn: employee.hired_on ?? '',
    terminatedOn: employee.terminated_on ?? '',
    employmentType: employee.employment_type,
    position: employee.position ?? '',
    primaryStoreId: employee.primary_store_id ?? '',
    status: employee.status === 'retired' ? 'retired' : 'active',
  };

  let confidentialInitial: ConfidentialData | null = null;
  let insuranceInitial: InsuranceData | null = null;
  if (canViewConfidential) {
    confidentialInitial = {
      employeeId: employee.id,
      bank: {
        bank: employee.bank_transfer_info?.bank ?? '',
        branch: employee.bank_transfer_info?.branch ?? '',
        type: employee.bank_transfer_info?.type ?? '',
        last4: employee.bank_transfer_info?.last4 ?? '',
        holder: employee.bank_transfer_info?.holder ?? '',
      },
      emergency: {
        name: employee.emergency_contact?.name ?? '',
        relation: employee.emergency_contact?.relation ?? '',
        phone: employee.emergency_contact?.phone ?? '',
      },
    };

    const { data: insurance } = await supabase
      .from('employee_insurance')
      .select('health_insurance, pension, employment_insurance, care_insurance, standard_monthly_remuneration, acquired_on, lost_on, region, note')
      .eq('employee_id', employee.id)
      .maybeSingle();

    insuranceInitial = {
      employeeId: employee.id,
      healthInsurance: insurance?.health_insurance ?? false,
      pension: insurance?.pension ?? false,
      employmentInsurance: insurance?.employment_insurance ?? false,
      careInsurance: insurance?.care_insurance ?? false,
      standardMonthlyRemuneration: insurance?.standard_monthly_remuneration != null ? String(insurance.standard_monthly_remuneration) : '',
      acquiredOn: insurance?.acquired_on ?? '',
      lostOn: insurance?.lost_on ?? '',
      region: insurance?.region ?? '',
      note: insurance?.note ?? '',
    };
  }

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
        description={`${EMPLOYMENT_TYPE_LABELS[employee.employment_type] ?? employee.employment_type}｜所属店舗: ${employee.stores?.name ?? '未設定'}｜入社日: ${formatDate(employee.hired_on)}`}
      />

      <div className="space-y-5">
        <BasicInfoForm initial={basicInitial} stores={ctx.stores} canEdit={canEdit} />
        {confidentialInitial && <ConfidentialForm initial={confidentialInitial} canEdit={canEdit} />}
        {insuranceInitial && <InsuranceForm initial={insuranceInitial} canEdit={canEdit} />}
      </div>
    </div>
  );
}
