/**
 * 会計データの操作権限（DB側 RLS / RPC の app_role_in と同じロール集合をUI側でも判定するための定数）。
 * lib/permissions.ts の PermissionAction には「会計の書込」に一致する項目がないため、
 * ここでローカルに定義する（accounts / journal_entries / accounting_periods / fixed_assets 等の write policy と同一）。
 */
import type { Role } from '@/lib/permissions';

export const ACCOUNTING_WRITE_ROLES: Role[] = ['org_owner', 'hq_admin', 'hq_accounting'];

export function canWriteAccounting(role: Role | null | undefined): boolean {
  return !!role && ACCOUNTING_WRITE_ROLES.includes(role);
}

/** 会計期間の締め解除は上位権限のみ（rpc reopen_accounting_period と同一） */
export const PERIOD_REOPEN_ROLES: Role[] = ['org_owner', 'hq_admin'];

export function canReopenPeriod(role: Role | null | undefined): boolean {
  return !!role && PERIOD_REOPEN_ROLES.includes(role);
}
