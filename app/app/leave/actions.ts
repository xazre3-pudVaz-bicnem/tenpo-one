'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { canReviewRequests, calcLeaveRemaining, insertLeaveTimeEntry, isPayrollLocked, mapDbErrorMessage } from '@/app/app/attendance/shared';

type ActionResult = { ok: boolean; message: string; warning?: boolean };

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

// ---------------------------------------------------------------
// 有給申請（本人）: 申請 → 取下げ
// ---------------------------------------------------------------

export interface CreateLeaveRequestInput {
  leaveDate: string;
  fraction: 1 | 0.5;
  reason: string;
}

/**
 * 有給申請の作成（本人）。同日の申請は leave_requests.(profile_id, leave_date) の DB UNIQUE で
 * 二重登録を防ぐが、取下げ(cancelled)・却下(rejected)後の再申請は同じ行を UPDATE して再度
 * pending に戻す（UNIQUE制約は状態を問わず効くため、INSERT ではなく UPDATE で対応する）。
 * 残数不足でも申請自体は拒否しない（承認側が判断できるよう warning として返す）。
 */
export async function createLeaveRequest(input: CreateLeaveRequestInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!input.leaveDate) return { ok: false, message: '申請日を入力してください' };
  if (input.fraction !== 1 && input.fraction !== 0.5) return { ok: false, message: '取得区分が正しくありません' };
  if (!input.reason.trim()) return { ok: false, message: '理由を入力してください' };

  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { ok: false, message: '所属店舗がありません' };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('leave_requests')
    .select('id, status')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('leave_date', input.leaveDate)
    .maybeSingle();

  if (existing && existing.status === 'pending') {
    return { ok: false, message: 'この日はすでに有給申請が受付中です' };
  }
  if (existing && existing.status === 'approved') {
    return { ok: false, message: 'この日はすでに有給取得が承認されています' };
  }

  let requestId: string;
  if (existing) {
    // cancelled / rejected: 同じ行を再利用して再申請する
    const { error } = await supabase
      .from('leave_requests')
      .update({
        store_id: store.id,
        fraction: input.fraction,
        reason: input.reason.trim(),
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        time_entry_id: null,
      })
      .eq('id', existing.id);
    if (error) return { ok: false, message: mapDbErrorMessage(error.message, '有給申請の送信に失敗しました') };
    requestId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('leave_requests')
      .insert({
        organization_id: ctx.organizationId,
        store_id: store.id,
        profile_id: ctx.userId,
        leave_date: input.leaveDate,
        fraction: input.fraction,
        reason: input.reason.trim(),
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !inserted) return { ok: false, message: mapDbErrorMessage(error?.message, '有給申請の送信に失敗しました') };
    requestId = inserted.id;
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: store.id,
    p_action: 'leave.request_create',
    p_target_table: 'leave_requests',
    p_target_id: requestId,
    p_before: null,
    p_after: { leave_date: input.leaveDate, fraction: input.fraction },
    p_note: input.reason.trim(),
  });

  revalidatePath('/app/leave');

  const remaining = await calcLeaveRemaining(supabase, ctx.organizationId, ctx.userId, todayJst());
  if (remaining - input.fraction < 0) {
    return { ok: true, warning: true, message: '有給申請を送信しました（残日数が不足している可能性があります）' };
  }
  return { ok: true, message: '有給申請を送信しました' };
}

/** 有給申請の取下げ（本人・pending中のみ） */
export async function withdrawLeaveRequest(requestId: string): Promise<ActionResult> {
  const ctx = await requireMember();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('leave_requests')
    .select('id, profile_id, status, store_id, leave_date')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!request) return { ok: false, message: '申請が見つかりません' };
  if (request.profile_id !== ctx.userId) return { ok: false, message: '本人以外は取下げできません' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', requestId);
  if (error) return { ok: false, message: '取下げに失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: request.store_id,
    p_action: 'leave.request_cancel',
    p_target_table: 'leave_requests',
    p_target_id: requestId,
    p_before: null,
    p_after: null,
    p_note: `有給申請を取下げ (${request.leave_date})`,
  });

  revalidatePath('/app/leave');
  return { ok: true, message: '有給申請を取下げました' };
}

// ---------------------------------------------------------------
// 有給申請（管理者）: 承認 → time_entries へ反映 / 却下
// ---------------------------------------------------------------

/**
 * 有給申請の承認。承認すると addManualEntry と同じロジック（insertLeaveTimeEntry）で
 * time_entries に leave_fraction 付きの勤怠行を作成し、leave_requests.time_entry_id に紐付ける。
 * 対象日がすでに給与確定期間ロック中の場合は、通常の勤怠追加では反映できないため、
 * 勤怠修正申請（/app/attendance）の利用を案内して承認をブロックする。
 */
export async function approveLeaveRequest(requestId: string): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!canReviewRequests(ctx.role)) return { ok: false, message: 'この操作を行う権限がありません' };
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!request) return { ok: false, message: '申請が見つかりません' };
  if (!ctx.stores.some((s) => s.id === request.store_id)) return { ok: false, message: '担当外の店舗です' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  if (await isPayrollLocked(supabase, ctx.organizationId, request.store_id, request.leave_date)) {
    return {
      ok: false,
      message: 'この期間は給与計算が確定済みのため通常の承認では反映できません。勤怠ページの「修正申請」で対応してください',
    };
  }

  const result = await insertLeaveTimeEntry(supabase, {
    organizationId: ctx.organizationId,
    storeId: request.store_id,
    profileId: request.profile_id,
    workDate: request.leave_date,
    leaveFraction: (request.fraction === 0.5 ? 0.5 : 1) as 1 | 0.5,
    note: request.reason?.trim() || '有給申請の承認による記録',
    approvedBy: ctx.userId,
  });
  if ('error' in result) return { ok: false, message: mapDbErrorMessage(result.error, '勤怠記録の作成に失敗しました') };

  const { error } = await supabase
    .from('leave_requests')
    .update({
      status: 'approved',
      time_entry_id: result.id,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  if (error) return { ok: false, message: '承認処理に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: request.store_id,
    p_action: 'leave.request_approve',
    p_target_table: 'leave_requests',
    p_target_id: requestId,
    p_before: null,
    p_after: { leave_date: request.leave_date, fraction: request.fraction, time_entry_id: result.id },
    p_note: `有給申請を承認 (${request.leave_date})`,
  });

  revalidatePath('/app/leave');
  revalidatePath('/app/attendance');

  const remaining = await calcLeaveRemaining(supabase, ctx.organizationId, request.profile_id, todayJst());
  if (remaining < 0) {
    return { ok: true, warning: true, message: '有給申請を承認しました（この時点で残日数がマイナスになっています）' };
  }
  return { ok: true, message: '有給申請を承認しました' };
}

/** 有給申請の却下 */
export async function rejectLeaveRequest(requestId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!canReviewRequests(ctx.role)) return { ok: false, message: 'この操作を行う権限がありません' };
  if (!reason.trim()) return { ok: false, message: '却下理由を入力してください' };
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('leave_requests')
    .select('id, store_id, status, leave_date')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!request) return { ok: false, message: '申請が見つかりません' };
  if (!ctx.stores.some((s) => s.id === request.store_id)) return { ok: false, message: '担当外の店舗です' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const { error } = await supabase
    .from('leave_requests')
    .update({
      status: 'rejected',
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      review_note: reason.trim(),
    })
    .eq('id', requestId);
  if (error) return { ok: false, message: '却下処理に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: request.store_id,
    p_action: 'leave.request_reject',
    p_target_table: 'leave_requests',
    p_target_id: requestId,
    p_before: null,
    p_after: null,
    p_note: reason.trim(),
  });

  revalidatePath('/app/leave');
  return { ok: true, message: '申請を却下しました' };
}
