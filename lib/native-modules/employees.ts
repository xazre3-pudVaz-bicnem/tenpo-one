import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { loadEmployeeDetail, loadEmployeeList } from '@/lib/employees-server';
import { NATIVE_EMPLOYEE_ACTION_TYPES, parseNativeEmployeeAction } from '@/lib/native-employees';
import { createEmployeeFromMember, updateEmployeeBasic, updateEmployeeConfidential, updateEmployeeInsurance } from '@/app/app/employees/actions';
import { EMPLOYEE_STATUS_LABEL, EMPLOYMENT_TYPE_LABELS } from '@/app/app/employees/constants';
import type { NativeModulePost } from '@/lib/native-modules/registry';

/**
 * 従業員台帳（/app/employees・/app/employees/[id]）の iPad ネイティブ。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 * 個人情報なので読み込みも POST（GET は iPad のファイルに残るため。lib/native-employees.ts の説明）。
 *   employeesLoad … 一覧（staff.manage。Web の一覧ページと同じ）
 *   employeeLoad  … 詳細（staff.manage か本人。機密・社会保険は payroll.view_all。Web の詳細ページと同じ）
 *   employeeCreate・employeeBasic・employeeConfidential・employeeInsurance … 保存（payroll.manage。Web の Server Action をそのまま呼ぶ）
 * どれも機能「給与・歩合」（payroll）が有効なとき（Web の /app/employees の機能と同じ）。
 */

function member(ctx: SessionContext): (SessionContext & { organizationId: string }) | null {
  return ctx.organizationId ? (ctx as SessionContext & { organizationId: string }) : null;
}

const forbid = (error: string) => ({ status: 403, body: { ok: false, error } });

/** 雇用区分の選択肢（Web の TYPE_OPTIONS と同じ順） */
const EMPLOYMENT_TYPES = Object.entries(EMPLOYMENT_TYPE_LABELS).map(([id, label]) => ({ id, label }));
const typeLabel = (t: string) => EMPLOYMENT_TYPE_LABELS[t] ?? t;

const employeePost: NativeModulePost = async ({ ctx, raw }) => {
  const m = member(ctx);
  if (!m) return { status: 401, body: { ok: false, error: 'ログインしてください' } };
  if (ctx.disabledFeatures.has('payroll')) return forbid('従業員台帳（給与・歩合）の機能は使えません');
  const parsed = parseNativeEmployeeAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const a = parsed.action;
  const stores = ctx.stores.map((s) => ({ id: s.id, name: s.name }));

  if (a.type === 'employeesLoad') {
    if (!can(ctx.role, 'staff.manage')) return forbid('従業員台帳を見る権限がありません');
    const d = await loadEmployeeList(m, await createClient(), {});
    return {
      body: {
        ok: true,
        canWrite: d.canWrite,
        rows: d.rows.map((r) => ({
          id: r.id,
          employeeNo: r.employee_no,
          legalName: r.legal_name,
          displayName: r.profiles?.display_name ?? null,
          employmentType: r.employment_type,
          employmentTypeLabel: typeLabel(r.employment_type),
          storeName: r.stores?.name ?? null,
          position: r.position,
          hiredOn: r.hired_on,
          hiredOnLabel: formatDate(r.hired_on),
          status: r.status,
          statusLabel: EMPLOYEE_STATUS_LABEL[r.status] ?? r.status,
        })),
        staffOptions: d.staffOptions,
        stores: d.canWrite ? stores : [],
        employmentTypes: EMPLOYMENT_TYPES,
      },
    };
  }

  if (a.type === 'employeeLoad') {
    const d = await loadEmployeeDetail(m, await createClient(), a.id);
    if (d.kind !== 'ok') return { body: { ok: true, state: d.kind, canViewList: d.canViewList } };
    return {
      body: {
        ok: true,
        state: 'ok',
        canViewList: d.canViewList,
        canEdit: d.canEdit,
        displayName: d.displayName,
        employmentType: d.employmentType,
        employmentTypeLabel: typeLabel(d.employmentType),
        storeName: d.storeName,
        hiredOn: d.hiredOn,
        hiredOnLabel: formatDate(d.hiredOn),
        basic: d.basic,
        confidential: d.confidential,
        insurance: d.insurance,
        stores,
        employmentTypes: EMPLOYMENT_TYPES,
      },
    };
  }

  // ここから下は保存（employees_write RLS と同じ payroll.manage）
  if (!can(ctx.role, 'payroll.manage')) return forbid('従業員情報を編集する権限がありません');
  switch (a.type) {
    case 'employeeCreate': {
      const r = await createEmployeeFromMember(a.input);
      return r.ok ? { body: { ok: true, id: r.employeeId ?? null, message: r.message } } : { body: { ok: false, error: r.message } };
    }
    case 'employeeBasic': {
      const r = await updateEmployeeBasic(a.input);
      return r.ok ? { body: { ok: true, message: r.message } } : { body: { ok: false, error: r.message } };
    }
    case 'employeeConfidential': {
      const r = await updateEmployeeConfidential(a.input);
      return r.ok ? { body: { ok: true, message: r.message } } : { body: { ok: false, error: r.message } };
    }
    case 'employeeInsurance': {
      const r = await updateEmployeeInsurance(a.input);
      return r.ok ? { body: { ok: true, message: r.message } } : { body: { ok: false, error: r.message } };
    }
  }
};

/** registry.ts の NATIVE_MODULE_POST に広げる（type → handler） */
export const EMPLOYEE_POSTS: Record<string, NativeModulePost> = Object.fromEntries(NATIVE_EMPLOYEE_ACTION_TYPES.map((t) => [t, employeePost]));
