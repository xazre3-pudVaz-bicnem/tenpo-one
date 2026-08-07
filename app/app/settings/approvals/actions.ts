'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ApprovalRuleLike } from '@/lib/approvals';

const PATH = '/app/settings/approvals';

export interface ActionResult {
  error?: string;
}

export interface ApprovalRuleInput {
  id?: string;
  target: ApprovalRuleLike['target'];
  minAmount: number;
  maxAmount: number | null;
  approverRole: ApprovalRuleLike['approverRole'];
  allowSelfApprove: boolean;
}

/** 承認ルール（金額帯×必要承認ロール）の追加・更新。org.settings権限のみ */
export async function saveApprovalRule(input: ApprovalRuleInput): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');

  if (!Number.isInteger(input.minAmount) || input.minAmount < 0) {
    return { error: '下限金額は0以上の整数で入力してください' };
  }
  if (input.maxAmount != null) {
    if (!Number.isInteger(input.maxAmount) || input.maxAmount <= input.minAmount) {
      return { error: '上限金額は下限金額より大きい整数で入力してください（空欄=上限なし）' };
    }
  }

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    target: input.target,
    min_amount: input.minAmount,
    max_amount: input.maxAmount,
    approver_role: input.approverRole,
    allow_self_approve: input.allowSelfApprove,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase
      .from('approval_rules')
      .update(payload)
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `承認ルールの更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase.from('approval_rules').insert({ ...payload, created_by: ctx.userId });
    if (error) return { error: `承認ルールの追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: input.id ? 'settings.approval_rules.update' : 'settings.approval_rules.add',
    p_target_table: 'approval_rules',
    p_target_id: input.id ?? ctx.organizationId,
    p_before: null,
    p_after: {
      target: input.target,
      min_amount: input.minAmount,
      max_amount: input.maxAmount,
      approver_role: input.approverRole,
      allow_self_approve: input.allowSelfApprove,
    },
    p_note: null,
  });

  revalidatePath(PATH);
  return {};
}

/** 承認ルールの削除 */
export async function deleteApprovalRule(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');

  const supabase = await createClient();
  const { error } = await supabase
    .from('approval_rules')
    .delete()
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `承認ルールの削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.approval_rules.delete',
    p_target_table: 'approval_rules',
    p_target_id: id,
    p_before: null,
    p_after: { deleted: true },
    p_note: null,
  });

  revalidatePath(PATH);
  return {};
}
