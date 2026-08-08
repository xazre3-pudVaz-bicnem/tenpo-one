'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: boolean; message: string };

// ---------------------------------------------------------------
// 有給付与の登録
// ---------------------------------------------------------------

export interface CreateLeaveGrantInput {
  profileId: string;
  days: number;
  grantedOn: string;
  expiresOn: string;
  reason: string;
  note: string;
}

/** 有給休暇の付与登録。leave_grants_write RLS（org_owner/hq_admin/hq_accounting/area_manager/store_manager）を想定し attendance.approve で判定する */
export async function createLeaveGrant(input: CreateLeaveGrantInput): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  if (!input.profileId) return { ok: false, message: '対象スタッフを選択してください' };
  if (!(input.days > 0)) return { ok: false, message: '付与日数は0より大きい値で入力してください' };
  if (!input.grantedOn || !input.expiresOn) return { ok: false, message: '付与日・失効日を入力してください' };
  if (input.expiresOn < input.grantedOn) return { ok: false, message: '失効日は付与日以降の日付にしてください' };

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', input.profileId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) return { ok: false, message: '対象のスタッフが見つかりません' };

  const reason = input.reason === 'adjustment' ? 'adjustment' : 'annual';

  const { data: inserted, error } = await supabase
    .from('leave_grants')
    .insert({
      organization_id: ctx.organizationId,
      profile_id: input.profileId,
      granted_on: input.grantedOn,
      days: input.days,
      expires_on: input.expiresOn,
      reason,
      note: input.note.trim() || null,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, message: `付与の登録に失敗しました: ${error?.message ?? '不明なエラー'}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'leave.grant',
    p_target_table: 'leave_grants',
    p_target_id: inserted.id,
    p_before: null,
    p_after: { profile_id: input.profileId, days: input.days, granted_on: input.grantedOn, expires_on: input.expiresOn, reason },
    p_note: input.note.trim() || null,
  });

  revalidatePath('/app/leave');
  return { ok: true, message: '有給休暇を付与しました' };
}

// ---------------------------------------------------------------
// 会社の有給付与ルール（organizations.leave_policy）
// ---------------------------------------------------------------

export interface LeavePolicyInput {
  expiryYears: number;
  memo: string;
}

export async function updateLeavePolicy(input: LeavePolicyInput): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');
  if (!(input.expiryYears > 0)) return { ok: false, message: '失効年数は1以上で入力してください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({
      leave_policy: { expiry_years: input.expiryYears, memo: input.memo.trim() || null },
      updated_by: ctx.userId,
    })
    .eq('id', ctx.organizationId);
  if (error) return { ok: false, message: `保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'org.leave_policy_update',
    p_target_table: 'organizations',
    p_target_id: ctx.organizationId,
    p_before: null,
    p_after: { expiry_years: input.expiryYears },
    p_note: null,
  });

  revalidatePath('/app/leave');
  return { ok: true, message: '有給付与ルールを保存しました' };
}
