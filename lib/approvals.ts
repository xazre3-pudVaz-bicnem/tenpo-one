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

/**
 * 同一target内で金額帯が重なるルールの組を返す（設定画面の重複警告表示用）。
 * [min,max) の半開区間として重なりを判定する（max=null は上限なし=∞扱い）。
 */
export function findOverlappingRules<T extends ApprovalRuleLike & { id: string }>(rules: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  const byTarget = new Map<string, T[]>();
  for (const r of rules) {
    const arr = byTarget.get(r.target) ?? [];
    arr.push(r);
    byTarget.set(r.target, arr);
  }
  for (const arr of byTarget.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const overlap = a.minAmount < (b.maxAmount ?? Infinity) && b.minAmount < (a.maxAmount ?? Infinity);
        if (overlap) pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

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
