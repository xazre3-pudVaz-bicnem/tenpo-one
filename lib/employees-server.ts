import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { createClient } from '@/lib/supabase/server';
import type { EmployeeBasicData } from '@/components/employees/basic-info-form';
import type { ConfidentialData } from '@/components/employees/confidential-form';
import type { InsuranceData } from '@/components/employees/insurance-form';

/**
 * 従業員台帳（/app/employees・/app/employees/[id]）の読み込み。Web のページと iPad のネイティブ
 * （lib/native-modules/employees.ts）で同じものを使う。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で
 * page.tsx から移した（取る列・権限の分け方は変えていない）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type MemberCtx = SessionContext & { organizationId: string };

export interface EmployeeRow {
  id: string;
  employee_no: string | null;
  legal_name: string | null;
  employment_type: string;
  position: string | null;
  hired_on: string | null;
  status: string;
  primary_store_id: string | null;
  profile_id: string;
  profiles: { display_name: string } | null;
  stores: { name: string } | null;
}

export interface EmployeeListData {
  rows: EmployeeRow[];
  /** 登録・編集（employees_write RLS と揃えて payroll.manage） */
  canWrite: boolean;
  /** 登録できるスタッフ（まだ従業員台帳に無い在籍メンバー）。canWrite のときだけ */
  staffOptions: { id: string; name: string }[];
}

/** 一覧（閲覧は staff.manage。呼ぶ側で確かめる）。q・type は Web の絞り込みと同じ */
export async function loadEmployeeList(
  ctx: MemberCtx,
  supabase: Supabase,
  filter: { q?: string; type?: string }
): Promise<EmployeeListData> {
  // 登録・編集は employees_write RLS（org_owner/hq_admin/hq_accounting）と揃えるため payroll.manage で判定する
  const canWrite = can(ctx.role, 'payroll.manage');

  const { data } = await supabase
    .from('employees')
    .select(
      'id, employee_no, legal_name, employment_type, position, hired_on, status, primary_store_id, profile_id, profiles(display_name), stores(name)'
    )
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });

  let rows = ((data ?? []) as unknown as EmployeeRow[]) ?? [];

  const q = (filter.q ?? '').trim();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.legal_name ?? '').includes(q) ||
        (r.profiles?.display_name ?? '').includes(q) ||
        (r.employee_no ?? '').includes(q)
    );
  }
  if (filter.type) rows = rows.filter((r) => r.employment_type === filter.type);

  let staffOptions: { id: string; name: string }[] = [];
  if (canWrite) {
    const [{ data: memberRows }, { data: existing }] = await Promise.all([
      supabase
        .from('memberships')
        .select('profile_id, profiles(id, display_name)')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active'),
      supabase.from('employees').select('profile_id').eq('organization_id', ctx.organizationId),
    ]);
    const usedIds = new Set((existing ?? []).map((e) => e.profile_id as string));
    staffOptions = (memberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        return p ? { id: p.id, name: p.display_name } : null;
      })
      .filter((s): s is { id: string; name: string } => !!s && !usedIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  return { rows, canWrite, staffOptions };
}

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
  profiles: { display_name: string } | null;
  stores: { name: string } | null;
}

interface ConfidentialRow {
  bank_transfer_info: { bank?: string; branch?: string; type?: string; last4?: string; holder?: string } | null;
  emergency_contact: { name?: string; relation?: string; phone?: string } | null;
}

export type EmployeeDetailData =
  | { kind: 'notFound'; canViewList: boolean }
  | { kind: 'forbidden'; canViewList: boolean }
  | {
      kind: 'ok';
      canViewList: boolean;
      /** 基本情報・機密・社会保険の保存（employees_write / employee_insurance_write RLS と揃えて payroll.manage） */
      canEdit: boolean;
      displayName: string;
      employmentType: string;
      storeName: string | null;
      hiredOn: string | null;
      basic: EmployeeBasicData;
      /** payroll.view_all のときだけ（それ以外は null） */
      confidential: ConfidentialData | null;
      /** payroll.view_all のときだけ（それ以外は null） */
      insurance: InsuranceData | null;
    };

/** 詳細（機能 payroll は呼ぶ側で確かめる）。一覧の権限（staff.manage）か本人だけが見られる。機密・社会保険は payroll.view_all だけ */
export async function loadEmployeeDetail(ctx: MemberCtx, supabase: Supabase, id: string): Promise<EmployeeDetailData> {
  const canViewList = can(ctx.role, 'staff.manage');
  // employees_write / employee_insurance_write RLS（org_owner/hq_admin/hq_accounting）と揃える
  const canEdit = can(ctx.role, 'payroll.manage');
  const canViewConfidential = can(ctx.role, 'payroll.view_all');

  // 機密列（bank_transfer_info・emergency_contact）は employees から消して employee_confidential に移した
  // （migration 00039）。前はここで employees の機密列も選んでいて、給与ロールだと列が無いエラーで
  // 「従業員情報が見つかりません」になっていた。機密は下で employee_confidential から読む
  const columns =
    'id, profile_id, employee_no, legal_name, legal_name_kana, postal_code, address, birth_date, hired_on, terminated_on, employment_type, position, primary_store_id, status, profiles(display_name), stores(name)';

  const { data } = await supabase.from('employees').select(columns).eq('id', id).eq('organization_id', ctx.organizationId).maybeSingle();
  const employee = data as unknown as EmployeeDetailRow | null;

  if (!employee) return { kind: 'notFound', canViewList };

  const isSelf = employee.profile_id === ctx.userId;
  if (!canViewList && !isSelf) return { kind: 'forbidden', canViewList };

  const displayName = employee.legal_name || employee.profiles?.display_name || '—';

  const basic: EmployeeBasicData = {
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

  let confidential: ConfidentialData | null = null;
  let insurance: InsuranceData | null = null;
  if (canViewConfidential) {
    // 機密情報は専用テーブル（RLSで給与ロール＋本人に限定）から取得
    const { data: confRaw } = await supabase
      .from('employee_confidential')
      .select('bank_transfer_info, emergency_contact')
      .eq('employee_id', employee.id)
      .maybeSingle();
    const conf = confRaw as ConfidentialRow | null;
    confidential = {
      employeeId: employee.id,
      bank: {
        bank: conf?.bank_transfer_info?.bank ?? '',
        branch: conf?.bank_transfer_info?.branch ?? '',
        type: conf?.bank_transfer_info?.type ?? '',
        last4: conf?.bank_transfer_info?.last4 ?? '',
        holder: conf?.bank_transfer_info?.holder ?? '',
      },
      emergency: {
        name: conf?.emergency_contact?.name ?? '',
        relation: conf?.emergency_contact?.relation ?? '',
        phone: conf?.emergency_contact?.phone ?? '',
      },
    };

    const { data: ins } = await supabase
      .from('employee_insurance')
      .select('health_insurance, pension, employment_insurance, care_insurance, standard_monthly_remuneration, acquired_on, lost_on, region, note')
      .eq('employee_id', employee.id)
      .maybeSingle();

    insurance = {
      employeeId: employee.id,
      healthInsurance: ins?.health_insurance ?? false,
      pension: ins?.pension ?? false,
      employmentInsurance: ins?.employment_insurance ?? false,
      careInsurance: ins?.care_insurance ?? false,
      standardMonthlyRemuneration: ins?.standard_monthly_remuneration != null ? String(ins.standard_monthly_remuneration) : '',
      acquiredOn: ins?.acquired_on ?? '',
      lostOn: ins?.lost_on ?? '',
      region: ins?.region ?? '',
      note: ins?.note ?? '',
    };
  }

  return {
    kind: 'ok',
    canViewList,
    canEdit,
    displayName,
    employmentType: employee.employment_type,
    storeName: employee.stores?.name ?? null,
    hiredOn: employee.hired_on,
    basic,
    confidential,
    insurance,
  };
}
