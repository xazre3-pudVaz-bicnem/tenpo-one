'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { can } from '@/lib/permissions';

export type PunchEventType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

type ActionResult = { ok: boolean; message: string };

const EVENT_LABELS: Record<PunchEventType, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
};

function mapPunchError(message: string): string {
  if (message.includes('ALREADY_CLOCKED_IN')) return 'すでに出勤打刻済みです';
  if (message.includes('NOT_CLOCKED_IN')) return '出勤打刻がされていません';
  if (message.includes('STORE_NOT_FOUND')) return '店舗情報が見つかりません';
  if (message.includes('FORBIDDEN')) return 'この操作を行う権限がありません';
  if (message.includes('INVALID_EVENT')) return '不正な打刻種別です';
  return '打刻に失敗しました。時間をおいて再度お試しください';
}

/** 本人打刻 */
export async function punch(storeId: string, eventType: PunchEventType): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.punch');
  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_punch', {
    p_store_id: storeId,
    p_profile_id: ctx.userId,
    p_event_type: eventType,
    p_source: 'personal',
  });
  if (error) return { ok: false, message: mapPunchError(error.message) };
  revalidatePath('/app/attendance');
  return { ok: true, message: `${EVENT_LABELS[eventType]}を記録しました` };
}

/** 共用端末モード: PINでスタッフを特定して打刻する */
export async function punchByPin(
  storeId: string,
  pin: string,
  eventType: PunchEventType
): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.punch');
  const admin = createAdminClient();

  const { data: memberships, error: findError } = await admin
    .from('memberships')
    .select('profile_id, profiles!inner(id, display_name, pin_code, status)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');

  if (findError) return { ok: false, message: 'スタッフ照合に失敗しました' };

  type Row = { profile_id: string; profiles: { id: string; display_name: string; pin_code: string | null; status: string } | null };
  const match = ((memberships ?? []) as unknown as Row[]).find(
    (m) => m.profiles && m.profiles.status === 'active' && m.profiles.pin_code && m.profiles.pin_code === pin
  );

  if (!match || !match.profiles) {
    return { ok: false, message: 'PINが正しくありません' };
  }

  const { error } = await admin.rpc('apply_punch', {
    p_store_id: storeId,
    p_profile_id: match.profile_id,
    p_event_type: eventType,
    p_source: 'shared_terminal',
    p_via_pin: true,
  });
  if (error) return { ok: false, message: mapPunchError(error.message) };
  revalidatePath('/app/attendance');
  return { ok: true, message: `${match.profiles.display_name}さん ${EVENT_LABELS[eventType]}を記録しました` };
}

/** JST の日付+時刻文字列を ISO(UTC) に変換する */
function jstToIso(workDate: string, hhmm: string): string {
  return new Date(`${workDate}T${hhmm}:00+09:00`).toISOString();
}

export interface CorrectionInput {
  storeId: string;
  profileId: string;
  timeEntryId: string | null;
  workDate: string;
  desiredClockIn: string; // HH:mm
  desiredClockOut: string; // HH:mm
  breakMinutes: number;
  reason: string;
}

/** 勤怠修正申請の作成（本人 or attendance.approve 権限者が代理登録） */
export async function requestCorrection(input: CorrectionInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!can(ctx.role, 'attendance.punch')) {
    return { ok: false, message: '権限がありません' };
  }
  if (input.profileId !== ctx.userId && !can(ctx.role, 'attendance.approve')) {
    return { ok: false, message: '本人以外の修正申請はできません' };
  }
  if (!input.reason.trim()) {
    return { ok: false, message: '理由を入力してください' };
  }

  const supabase = await createClient();
  const requestedChanges = {
    work_date: input.workDate,
    clock_in_at: jstToIso(input.workDate, input.desiredClockIn),
    clock_out_at: jstToIso(input.workDate, input.desiredClockOut),
    break_minutes: input.breakMinutes,
  };

  const { error } = await supabase.from('attendance_requests').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    profile_id: input.profileId,
    time_entry_id: input.timeEntryId,
    request_type: 'correction',
    requested_changes: requestedChanges,
    reason: input.reason.trim(),
    status: 'pending',
    created_by: ctx.userId,
  });

  if (error) return { ok: false, message: '修正申請の送信に失敗しました' };
  revalidatePath('/app/attendance');
  return { ok: true, message: '修正申請を送信しました' };
}

/** 修正申請の承認: time_entries を反映し監査ログを記録する */
export async function approveRequest(requestId: string): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  const supabase = await createClient();

  const { data: request, error: fetchError } = await supabase
    .from('attendance_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (fetchError || !request) return { ok: false, message: '申請が見つかりません' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const changes = request.requested_changes as {
    work_date: string;
    clock_in_at: string;
    clock_out_at: string;
    break_minutes: number;
  };

  let before: unknown = null;
  let targetId = request.time_entry_id as string | null;

  if (targetId) {
    const { data: existing } = await supabase.from('time_entries').select('*').eq('id', targetId).single();
    before = existing ?? null;
    const { error: updateError } = await supabase
      .from('time_entries')
      .update({
        clock_in_at: changes.clock_in_at,
        clock_out_at: changes.clock_out_at,
        break_minutes: changes.break_minutes,
        status: 'approved',
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', targetId);
    if (updateError) return { ok: false, message: '勤怠記録の更新に失敗しました' };
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('time_entries')
      .insert({
        organization_id: ctx.organizationId,
        store_id: request.store_id,
        profile_id: request.profile_id,
        work_date: changes.work_date,
        clock_in_at: changes.clock_in_at,
        clock_out_at: changes.clock_out_at,
        break_minutes: changes.break_minutes,
        status: 'approved',
        source: 'manual',
        approved_by: ctx.userId,
        approved_at: new Date().toISOString(),
        created_by: ctx.userId,
      })
      .select('id')
      .single();
    if (insertError || !inserted) return { ok: false, message: '勤怠記録の作成に失敗しました' };
    targetId = inserted.id;
  }

  await supabase
    .from('attendance_requests')
    .update({
      status: 'approved',
      time_entry_id: targetId,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: request.store_id,
    p_action: 'attendance.approve_request',
    p_target_table: 'attendance_requests',
    p_target_id: requestId,
    p_before: before,
    p_after: changes,
    p_note: `勤怠修正申請を承認 (${changes.work_date})`,
  });

  revalidatePath('/app/attendance');
  return { ok: true, message: '修正申請を承認しました' };
}

/** 修正申請の却下 */
export async function rejectRequest(requestId: string, reason: string): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  if (!reason.trim()) return { ok: false, message: '却下理由を入力してください' };
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('attendance_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!request) return { ok: false, message: '申請が見つかりません' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const { error } = await supabase
    .from('attendance_requests')
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
    p_action: 'attendance.reject_request',
    p_target_table: 'attendance_requests',
    p_target_id: requestId,
    p_before: null,
    p_after: null,
    p_note: reason.trim(),
  });

  revalidatePath('/app/attendance');
  return { ok: true, message: '申請を却下しました' };
}
