/**
 * ロール × アクション権限の単一定義。
 * UI表示制御・Server Action検証・（RLSは同等条件をSQL関数で実装）の3層で使用する。
 * docs/permissions-matrix.md と同期を保つこと。
 */

export const ROLES = [
  'org_owner',
  'hq_admin',
  'hq_accounting',
  'area_manager',
  'store_manager',
  'assistant_manager',
  'staff',
  'part_time',
  'external_accountant',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  org_owner: '契約企業オーナー',
  hq_admin: '本社管理者',
  hq_accounting: '本社経理担当',
  area_manager: 'エリアマネージャー',
  store_manager: '店長',
  assistant_manager: '副店長',
  staff: '一般スタッフ',
  part_time: 'アルバイト',
  external_accountant: '外部税理士・会計担当',
};

/** 企業内全店舗へアクセスできるロール */
export const HQ_ROLES: Role[] = ['org_owner', 'hq_admin', 'hq_accounting', 'external_accountant'];

export type PermissionAction =
  | 'dashboard.view'
  | 'reservations.view'
  | 'reservations.write'
  | 'reservations.cancel'
  | 'tables.operate'
  | 'pos.order'
  | 'pos.checkout'
  | 'pos.discount'
  | 'pos.refund'
  | 'register.operate'
  | 'register.approve'
  | 'cash.write'
  | 'cash.approve'
  | 'customers.view'
  | 'customers.write'
  | 'customers.delete'
  | 'documents.write'
  | 'invoices.approve'
  | 'vendors.manage'
  | 'inventory.view'
  | 'inventory.write'
  | 'attendance.punch'
  | 'attendance.approve'
  | 'shifts.manage'
  | 'payroll.manage'
  | 'payroll.view_all'
  | 'reports.view'
  | 'csv.export'
  | 'menu.manage'
  | 'store.settings'
  | 'staff.manage'
  | 'org.settings'
  | 'audit.view';

const P: Record<PermissionAction, Role[]> = {
  'dashboard.view': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'external_accountant'],
  'reservations.view': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time'],
  'reservations.write': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'reservations.cancel': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'tables.operate': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time'],
  'pos.order': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time'],
  'pos.checkout': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time'],
  'pos.discount': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'],
  'pos.refund': ['org_owner', 'hq_admin', 'area_manager', 'store_manager'],
  'register.operate': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'register.approve': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager'],
  'cash.write': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager'],
  'cash.approve': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager'],
  'customers.view': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'customers.write': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'customers.delete': ['org_owner', 'hq_admin', 'area_manager', 'store_manager'],
  'documents.write': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager'],
  'invoices.approve': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager'],
  'vendors.manage': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'],
  'inventory.view': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'external_accountant'],
  'inventory.write': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager', 'staff'],
  'attendance.punch': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager', 'staff', 'part_time'],
  'attendance.approve': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'],
  'shifts.manage': ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'],
  'payroll.manage': ['org_owner', 'hq_admin', 'hq_accounting'],
  'payroll.view_all': ['org_owner', 'hq_admin', 'hq_accounting', 'external_accountant'],
  'reports.view': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'assistant_manager', 'external_accountant'],
  'csv.export': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'external_accountant'],
  'menu.manage': ['org_owner', 'hq_admin', 'area_manager', 'store_manager'],
  'store.settings': ['org_owner', 'hq_admin', 'area_manager', 'store_manager'],
  'staff.manage': ['org_owner', 'hq_admin', 'area_manager', 'store_manager'],
  'org.settings': ['org_owner', 'hq_admin'],
  'audit.view': ['org_owner', 'hq_admin', 'hq_accounting', 'area_manager', 'store_manager', 'external_accountant'],
};

export function can(role: Role | null | undefined, action: PermissionAction): boolean {
  if (!role) return false;
  return P[action].includes(role);
}

export function isHqRole(role: Role | null | undefined): boolean {
  return !!role && HQ_ROLES.includes(role);
}

/**
 * ロールの序列（数値が小さいほど上位）。
 * 招待・ロール変更で「自分より上位のロールを付与/操作できない」（role ceiling）を強制するために使用する。
 * external_accountant は業務階層に属さない別枠のロールとして扱う（付与はHQ相当ロールのみ）。
 */
export const ROLE_RANK: Record<Role, number> = {
  org_owner: 0,
  hq_admin: 1,
  hq_accounting: 2,
  area_manager: 3,
  store_manager: 4,
  assistant_manager: 5,
  staff: 6,
  part_time: 6,
  external_accountant: 6,
};

/**
 * actorRole が targetRole を付与（招待・ロール変更）できるかを判定する（role ceiling）。
 * - org_owner のみ org_owner を付与できる
 * - external_accountant は本社ロール（org_owner / hq_admin / hq_accounting）のみ付与できる
 * - それ以外は ROLE_RANK が自分（actorRole）以上＝同格以下のロールのみ付与できる
 *   （例: store_manager / area_manager は org_owner・hq_admin・hq_accounting を付与できない）
 */
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === 'org_owner') return actorRole === 'org_owner';
  if (targetRole === 'external_accountant') {
    return actorRole === 'org_owner' || actorRole === 'hq_admin' || actorRole === 'hq_accounting';
  }
  return ROLE_RANK[targetRole] >= ROLE_RANK[actorRole];
}

/** targetRole が actorRole より上位（ROLE_RANK の数値が小さい）なら true。既存メンバーの操作可否判定に使用する。 */
export function roleOutranks(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}
