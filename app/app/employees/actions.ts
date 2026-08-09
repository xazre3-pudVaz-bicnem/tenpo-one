'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: boolean; message: string };

const EMPLOYMENT_TYPES = ['full_time', 'contract', 'part_time', 'outsourced'] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

function isEmploymentType(v: string): v is EmploymentType {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------
// 従業員台帳への登録（スタッフ(memberships)から選択）
// ---------------------------------------------------------------

export interface CreateEmployeeInput {
  profileId: string;
  employeeNo: string;
  employmentType: string;
  primaryStoreId: string | null;
  hiredOn: string | null;
}

/**
 * memberships のスタッフから employees 行を新規作成する。
 * employees_write RLS（org_owner/hq_admin/hq_accounting）と一致させるため payroll.manage で権限判定する。
 */
export async function createEmployeeFromMember(
  input: CreateEmployeeInput
): Promise<ActionResult & { employeeId?: string }> {
  const ctx = await requirePermission('payroll.manage');
  if (!input.profileId) return { ok: false, message: '対象スタッフを選択してください' };
  if (!isEmploymentType(input.employmentType)) return { ok: false, message: '雇用区分が正しくありません' };
  if (input.primaryStoreId !== null && !ctx.stores.some((s) => s.id === input.primaryStoreId)) {
    return { ok: false, message: '所属店舗にアクセス権がありません' };
  }

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from('memberships')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', input.profileId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) return { ok: false, message: '対象のスタッフが見つかりません' };

  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', input.profileId)
    .maybeSingle();
  if (existing) return { ok: false, message: 'このスタッフは既に従業員情報が登録されています' };

  const { data: inserted, error } = await supabase
    .from('employees')
    .insert({
      organization_id: ctx.organizationId,
      profile_id: input.profileId,
      employee_no: input.employeeNo.trim() || null,
      employment_type: input.employmentType,
      primary_store_id: input.primaryStoreId,
      hired_on: input.hiredOn || null,
      status: 'active',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, message: `登録に失敗しました: ${error?.message ?? '不明なエラー'}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.primaryStoreId,
    p_action: 'employee.create',
    p_target_table: 'employees',
    p_target_id: inserted.id,
    p_before: null,
    p_after: { employment_type: input.employmentType },
    p_note: null,
  });

  revalidatePath('/app/employees');
  return { ok: true, message: '従業員情報を登録しました', employeeId: inserted.id };
}

// ---------------------------------------------------------------
// 基本情報の編集
// ---------------------------------------------------------------

export interface UpdateEmployeeBasicInput {
  id: string;
  employeeNo: string;
  legalName: string;
  legalNameKana: string;
  postalCode: string;
  address: string;
  birthDate: string | null;
  hiredOn: string | null;
  terminatedOn: string | null;
  employmentType: string;
  position: string;
  primaryStoreId: string | null;
  status: string;
}

const BASIC_FIELDS = [
  'employee_no',
  'legal_name',
  'legal_name_kana',
  'postal_code',
  'address',
  'birth_date',
  'hired_on',
  'terminated_on',
  'employment_type',
  'position',
  'primary_store_id',
  'status',
] as const;

export async function updateEmployeeBasic(input: UpdateEmployeeBasicInput): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  if (!isEmploymentType(input.employmentType)) return { ok: false, message: '雇用区分が正しくありません' };
  if (!['active', 'retired'].includes(input.status)) return { ok: false, message: '状態が正しくありません' };
  if (input.primaryStoreId !== null && !ctx.stores.some((s) => s.id === input.primaryStoreId)) {
    return { ok: false, message: '所属店舗にアクセス権がありません' };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('employees')
    .select(BASIC_FIELDS.join(','))
    .eq('id', input.id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!before) return { ok: false, message: '対象の従業員が見つかりません' };

  const after = {
    employee_no: input.employeeNo.trim() || null,
    legal_name: input.legalName.trim() || null,
    legal_name_kana: input.legalNameKana.trim() || null,
    postal_code: input.postalCode.trim() || null,
    address: input.address.trim() || null,
    birth_date: input.birthDate || null,
    hired_on: input.hiredOn || null,
    terminated_on: input.terminatedOn || null,
    employment_type: input.employmentType,
    position: input.position.trim() || null,
    primary_store_id: input.primaryStoreId,
    status: input.status,
    updated_by: ctx.userId,
  };

  const { error } = await supabase
    .from('employees')
    .update(after)
    .eq('id', input.id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { ok: false, message: `更新に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.primaryStoreId,
    p_action: 'employee.update',
    p_target_table: 'employees',
    p_target_id: input.id,
    p_before: before,
    p_after: after,
    p_note: '基本情報を更新',
  });

  revalidatePath(`/app/employees/${input.id}`);
  revalidatePath('/app/employees');
  return { ok: true, message: '基本情報を保存しました' };
}

// ---------------------------------------------------------------
// 機密情報（銀行振込・緊急連絡先）の編集
// 監査ログには変更されたフィールド名のみを記録し、値は保存しない。
// ---------------------------------------------------------------

export interface UpdateEmployeeConfidentialInput {
  id: string;
  bank: { bank: string; branch: string; type: string; last4: string; holder: string };
  emergency: { name: string; relation: string; phone: string };
}

export async function updateEmployeeConfidential(input: UpdateEmployeeConfidentialInput): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  if (input.bank.last4 && !/^\d{4}$/.test(input.bank.last4)) {
    return { ok: false, message: '口座番号末尾は4桁の数字で入力してください' };
  }

  const supabase = await createClient();
  // 従業員本体の存在・所属確認（機密列は保持していない）
  const { data: emp } = await supabase
    .from('employees')
    .select('id, organization_id, profile_id')
    .eq('id', input.id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!emp) return { ok: false, message: '対象の従業員が見つかりません' };

  // 変更検知用に現行の機密情報を専用テーブルから取得
  const { data: before } = await supabase
    .from('employee_confidential')
    .select('bank_transfer_info, emergency_contact')
    .eq('employee_id', input.id)
    .maybeSingle();

  const bankTransferInfo = {
    bank: input.bank.bank.trim() || null,
    branch: input.bank.branch.trim() || null,
    type: input.bank.type.trim() || null,
    last4: input.bank.last4.trim() || null,
    holder: input.bank.holder.trim() || null,
  };
  const emergencyContact = {
    name: input.emergency.name.trim() || null,
    relation: input.emergency.relation.trim() || null,
    phone: input.emergency.phone.trim() || null,
  };

  const changedFields: string[] = [];
  if (JSON.stringify(before?.bank_transfer_info ?? null) !== JSON.stringify(bankTransferInfo)) changedFields.push('bank_transfer_info');
  if (JSON.stringify(before?.emergency_contact ?? null) !== JSON.stringify(emergencyContact)) changedFields.push('emergency_contact');

  const { error } = await supabase
    .from('employee_confidential')
    .upsert(
      {
        employee_id: input.id,
        organization_id: ctx.organizationId,
        profile_id: emp.profile_id,
        bank_transfer_info: bankTransferInfo,
        emergency_contact: emergencyContact,
        updated_by: ctx.userId,
      },
      { onConflict: 'employee_id' }
    );
  if (error) return { ok: false, message: `更新に失敗しました: ${error.message}` };

  // 機密フィールドの値は監査ログへ保存しない（変更されたフィールド名のみ記録）
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'employee.update',
    p_target_table: 'employee_confidential',
    p_target_id: input.id,
    p_before: null,
    p_after: { changed_fields: changedFields },
    p_note: '機密情報（銀行振込・緊急連絡先）を更新（値は監査ログに記録されません）',
  });

  revalidatePath(`/app/employees/${input.id}`);
  return { ok: true, message: '機密情報を保存しました' };
}

// ---------------------------------------------------------------
// 社会保険（構造のみ。料率・自動計算は行わない）
// ---------------------------------------------------------------

export interface UpdateEmployeeInsuranceInput {
  employeeId: string;
  healthInsurance: boolean;
  pension: boolean;
  employmentInsurance: boolean;
  careInsurance: boolean;
  standardMonthlyRemuneration: number | null;
  acquiredOn: string | null;
  lostOn: string | null;
  region: string;
  note: string;
}

export async function updateEmployeeInsurance(input: UpdateEmployeeInsuranceInput): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from('employees')
    .select('id, primary_store_id')
    .eq('id', input.employeeId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!employee) return { ok: false, message: '対象の従業員が見つかりません' };

  const { data: before } = await supabase
    .from('employee_insurance')
    .select('*')
    .eq('employee_id', input.employeeId)
    .maybeSingle();

  const payload = {
    organization_id: ctx.organizationId,
    employee_id: input.employeeId,
    health_insurance: input.healthInsurance,
    pension: input.pension,
    employment_insurance: input.employmentInsurance,
    care_insurance: input.careInsurance,
    standard_monthly_remuneration: input.standardMonthlyRemuneration,
    acquired_on: input.acquiredOn || null,
    lost_on: input.lostOn || null,
    region: input.region.trim() || null,
    note: input.note.trim() || null,
    updated_by: ctx.userId,
  };

  const { error } = before
    ? await supabase.from('employee_insurance').update(payload).eq('employee_id', input.employeeId)
    : await supabase.from('employee_insurance').insert({ ...payload, created_by: ctx.userId });
  if (error) return { ok: false, message: `社会保険情報の保存に失敗しました: ${error.message}` };

  // 標準報酬月額・資格取得喪失日等の値は監査ログへ保存しない（フィールド名のみ記録）
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: employee.primary_store_id,
    p_action: 'employee.update',
    p_target_table: 'employee_insurance',
    p_target_id: input.employeeId,
    p_before: null,
    p_after: { changed_fields: ['insurance_settings'] },
    p_note: '社会保険情報を更新（値は監査ログに記録されません）',
  });

  revalidatePath(`/app/employees/${input.employeeId}`);
  return { ok: true, message: '社会保険情報を保存しました' };
}
