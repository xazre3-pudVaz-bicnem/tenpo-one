/**
 * POS担当者の役職（pos_clerks.role）。
 *
 * レジは店舗共通のアカウントで使うので、ログインアカウントでは誰が操作しているか分からない。
 * 取消（品目取消・注文取消）は「店長以上」しかできない、という店舗運用（2026-09-24 要望）を
 * 担当者の役職で判定する。
 *
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export const CLERK_ROLES = ['staff', 'assistant_manager', 'store_manager', 'area_manager', 'owner'] as const;

export type ClerkRole = (typeof CLERK_ROLES)[number];

export const CLERK_ROLE_LABELS: Record<ClerkRole, string> = {
  staff: 'スタッフ',
  assistant_manager: '副店長',
  store_manager: '店長',
  area_manager: 'エリアマネージャー',
  owner: 'オーナー',
};

/** レジは日本語が読めない人も使うので、小さく英語も出す */
export const CLERK_ROLE_EN: Record<ClerkRole, string> = {
  staff: 'Staff',
  assistant_manager: 'Assistant manager',
  store_manager: 'Manager',
  area_manager: 'Area manager',
  owner: 'Owner',
};

/** 上下関係（数値が小さいほど上位） */
export const CLERK_ROLE_RANK: Record<ClerkRole, number> = {
  owner: 0,
  area_manager: 1,
  store_manager: 2,
  assistant_manager: 3,
  staff: 4,
};

/** DB・Cookie から来た値を役職にする。知らない値・空は staff（いちばん下）にする */
export function parseClerkRole(value: unknown): ClerkRole {
  return typeof value === 'string' && (CLERK_ROLES as readonly string[]).includes(value)
    ? (value as ClerkRole)
    : 'staff';
}

/**
 * 取消（品目取消・注文取消）ができるか。店長以上だけ（2026-09-24 店舗要望）。
 */
export function clerkCanCancel(role: ClerkRole | null | undefined): boolean {
  if (!role) return false;
  return CLERK_ROLE_RANK[role] <= CLERK_ROLE_RANK.store_manager;
}

/** 取消の承認に出す担当者（店長以上）だけを残す */
export function cancelApprovers<T extends { role: ClerkRole }>(clerks: readonly T[]): T[] {
  return clerks.filter((c) => clerkCanCancel(c.role));
}
