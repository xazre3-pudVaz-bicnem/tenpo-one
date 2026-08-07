/**
 * 承認エンジン（純関数・テスト対象）。
 * approval_rules（金額帯 × 必要承認ロール）から必要承認者を解決する。
 * 対象: 請求書 / 経費 / 小口現金 / 発注。ルール未設定時は従来の権限のみで承認可。
 */
import type { Role } from '@/lib/permissions';

export interface ApprovalRuleLike {
  target: 'invoice' | 'expense' | 'petty_cash' | 'purchase_order';
  minAmount: number;
  maxAmount: number | null;
  approverRole: 'store_manager' | 'area_manager' | 'hq_accounting' | 'hq_admin' | 'org_owner';
  allowSelfApprove: boolean;
}

/** ロールの承認強度（上位ロールは下位要求も満たす） */
const ROLE_RANK: Record<string, number> = {
  part_time: 0,
  staff: 1,
  assistant_manager: 2,
  store_manager: 3,
  area_manager: 4,
  hq_accounting: 5,
  hq_admin: 6,
  org_owner: 7,
  external_accountant: 0, // 閲覧専用
};

/** 金額に適用されるルールを返す（該当なし=null → 既存権限のみで承認可） */
export function resolveApprovalRule(
  rules: ApprovalRuleLike[],
  target: ApprovalRuleLike['target'],
  amount: number
): ApprovalRuleLike | null {
  const candidates = rules
    .filter((r) => r.target === target && amount >= r.minAmount && (r.maxAmount == null || amount < r.maxAmount))
    .sort((a, b) => b.minAmount - a.minAmount);
  return candidates[0] ?? null;
}

export interface ApprovalCheck {
  allowed: boolean;
  reason?: 'insufficient_role' | 'self_approve_forbidden';
  requiredRoleLabel?: string;
}

const ROLE_LABELS: Record<ApprovalRuleLike['approverRole'], string> = {
  store_manager: '店長',
  area_manager: 'エリアマネージャー',
  hq_accounting: '本社経理',
  hq_admin: '本社管理者',
  org_owner: '企業オーナー',
};

/** 承認可否の判定 */
export function checkApproval(
  rule: ApprovalRuleLike | null,
  approverRole: Role,
  approverIsRequester: boolean
): ApprovalCheck {
  if (!rule) return { allowed: true }; // ルール未設定は既存の権限チェックに委ねる
  if ((ROLE_RANK[approverRole] ?? 0) < ROLE_RANK[rule.approverRole]) {
    return {
      allowed: false,
      reason: 'insufficient_role',
      requiredRoleLabel: ROLE_LABELS[rule.approverRole],
    };
  }
  if (approverIsRequester && !rule.allowSelfApprove) {
    return { allowed: false, reason: 'self_approve_forbidden' };
  }
  return { allowed: true };
}
