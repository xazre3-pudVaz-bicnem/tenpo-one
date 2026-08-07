'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 締め後ロック: 指定店舗・指定日が確定済み(confirmed)/承認済み(approved)の給与計算(payroll_runs)の
 * 対象期間に含まれるかを判定する。含まれる場合、time_entries を書き換える操作
 * （修正申請の承認・区分変更・手動追加）はサーバー側で拒否する。
 * payroll_runs.store_id が null の run は「全社」対象のため、その run の期間も対象に含める。
 */
async function isPayrollLocked(
  supabase: SupabaseServerClient,
  organizationId: string,
  storeId: string,
  workDate: string
): Promise<boolean> {
  const { data } = await supabase
    .from('payroll_runs')
    .select('id')
    .eq('organization_id', organizationId)
    .in('status', ['confirmed', 'approved'])
    .lte('period_start', workDate)
    .gte('period_end', workDate)
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

const PAYROLL_LOCKED_MESSAGE = 'この期間は給与計算が確定済みのためロックされています';

export type PunchEventType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

export type EntryType = 'normal' | 'late' | 'early_leave' | 'absent' | 'paid_leave' | 'holiday_work';

/** warning=true の場合、呼び出し側は toast を warning 色で表示する（例: 休憩中退勤の自動確定） */
type ActionResult = { ok: boolean; message: string; warning?: boolean };

export const EVENT_LABELS: Record<PunchEventType, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
};

function mapPunchError(message: string): string {
  // ALREADY_CLOCKED_IN_ELSEWHERE は ALREADY_CLOCKED_IN の部分文字列を含むため先に判定する
  if (message.includes('ALREADY_CLOCKED_IN_ELSEWHERE')) return '他店舗で出勤打刻が残っています';
  if (message.includes('ALREADY_CLOCKED_IN')) return 'すでに出勤打刻済みです';
  if (message.includes('ALREADY_ON_BREAK')) return 'すでに休憩中です';
  if (message.includes('NOT_ON_BREAK')) return '休憩中ではありません';
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
  const { data, error } = await supabase.rpc('apply_punch', {
    p_store_id: storeId,
    p_profile_id: ctx.userId,
    p_event_type: eventType,
    p_source: 'personal',
  });
  if (error) return { ok: false, message: mapPunchError(error.message) };

  // シフトとの突合: 出勤打刻のみ対象。確定・公開済みシフトの開始時刻より15分を超えて
  // 遅れて出勤した場合は自動的に entry_type='late'（遅刻）へ変更する。
  if (eventType === 'clock_in') {
    const entryId = (data as { entry_id?: string } | null)?.entry_id;
    if (entryId) await autoFlagLateEntry(storeId, ctx.userId, entryId);
  }

  // apply_punch は休憩中のまま退勤した場合など、休憩を自動確定した際に warning を返す
  const warningNote = (data as { warning?: string | null } | null)?.warning ?? null;

  revalidatePath('/app/attendance');
  return warningNote
    ? { ok: true, message: `${EVENT_LABELS[eventType]}を記録しました（${warningNote}）`, warning: true }
    : { ok: true, message: `${EVENT_LABELS[eventType]}を記録しました` };
}

/**
 * 出勤打刻がシフト開始時刻より15分超遅れていれば entry_type を'late'に更新する。
 * time_entries への更新は attendance.approve 相当のロール限定（RLS）のため、
 * 本人（一般スタッフ）打刻からの自動区分変更は管理クライアントで行う。
 */
async function autoFlagLateEntry(storeId: string, profileId: string, entryId: string): Promise<void> {
  const supabase = await createClient();
  const today = todayJst();

  const { data: shift } = await supabase
    .from('shifts')
    .select('start_time')
    .eq('store_id', storeId)
    .eq('profile_id', profileId)
    .eq('shift_date', today)
    .eq('kind', 'confirmed')
    .eq('status', 'published')
    .order('start_time')
    .limit(1)
    .maybeSingle();
  if (!shift) return;

  const toMinutes = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  };
  const nowHHmm = new Date().toLocaleTimeString('sv-SE', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const lateMinutes = toMinutes(nowHHmm) - toMinutes(shift.start_time);
  if (lateMinutes <= 15) return;

  const admin = createAdminClient();
  await admin
    .from('time_entries')
    .update({
      entry_type: 'late',
      note: `シフト開始(${shift.start_time.slice(0, 5)})より${lateMinutes}分遅れて出勤したため自動的に「遅刻」区分に設定しました`,
    })
    .eq('id', entryId);
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

  const { data, error } = await admin.rpc('apply_punch', {
    p_store_id: storeId,
    p_profile_id: match.profile_id,
    p_event_type: eventType,
    p_source: 'shared_terminal',
    p_via_pin: true,
  });
  if (error) return { ok: false, message: mapPunchError(error.message) };

  const warningNote = (data as { warning?: string | null } | null)?.warning ?? null;
  revalidatePath('/app/attendance');
  return warningNote
    ? {
        ok: true,
        message: `${match.profiles.display_name}さん ${EVENT_LABELS[eventType]}を記録しました（${warningNote}）`,
        warning: true,
      }
    : { ok: true, message: `${match.profiles.display_name}さん ${EVENT_LABELS[eventType]}を記録しました` };
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

  if (await isPayrollLocked(supabase, ctx.organizationId, request.store_id, changes.work_date)) {
    return { ok: false, message: PAYROLL_LOCKED_MESSAGE };
  }

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

// ---------------------------------------------------------------
// 勤怠区分の管理
// ---------------------------------------------------------------

export interface ChangeEntryTypeInput {
  timeEntryId: string;
  entryType: EntryType;
  reason: string;
}

/** 勤怠区分の変更（attendance.approve 権限者のみ）。監査ログに記録する。 */
export async function changeEntryType(input: ChangeEntryTypeInput): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  if (!input.reason.trim()) return { ok: false, message: '理由を入力してください' };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('time_entries')
    .select('id, store_id, entry_type, work_date')
    .eq('id', input.timeEntryId)
    .single();
  if (!before) return { ok: false, message: '勤怠記録が見つかりません' };

  if (await isPayrollLocked(supabase, ctx.organizationId, before.store_id, before.work_date)) {
    return { ok: false, message: PAYROLL_LOCKED_MESSAGE };
  }

  const { error } = await supabase
    .from('time_entries')
    .update({ entry_type: input.entryType, note: input.reason.trim(), updated_by: ctx.userId })
    .eq('id', input.timeEntryId);
  if (error) return { ok: false, message: '区分の変更に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: before.store_id,
    p_action: 'attendance.change_entry_type',
    p_target_table: 'time_entries',
    p_target_id: input.timeEntryId,
    p_before: { entry_type: before.entry_type },
    p_after: { entry_type: input.entryType },
    p_note: input.reason.trim(),
  });

  revalidatePath('/app/attendance');
  return { ok: true, message: '区分を変更しました' };
}

export interface ManualEntryInput {
  storeId: string;
  profileId: string;
  workDate: string;
  entryType: 'paid_leave' | 'absent';
  reason: string;
}

/**
 * 打刻なしの勤怠（有給・欠勤）を手動追加する（attendance.approve 権限者のみ）。
 * clock_in_at / clock_out_at は null のまま status='approved' で登録する。
 */
export async function addManualEntry(input: ManualEntryInput): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  if (!input.profileId) return { ok: false, message: '対象スタッフを選択してください' };
  if (!input.workDate) return { ok: false, message: '日付を入力してください' };
  if (input.entryType !== 'paid_leave' && input.entryType !== 'absent') {
    return { ok: false, message: '区分が正しくありません' };
  }
  if (!input.reason.trim()) return { ok: false, message: '理由を入力してください' };

  const supabase = await createClient();

  if (await isPayrollLocked(supabase, ctx.organizationId, input.storeId, input.workDate)) {
    return { ok: false, message: PAYROLL_LOCKED_MESSAGE };
  }

  const { data: inserted, error } = await supabase
    .from('time_entries')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      profile_id: input.profileId,
      work_date: input.workDate,
      clock_in_at: null,
      clock_out_at: null,
      break_minutes: 0,
      entry_type: input.entryType,
      status: 'approved',
      source: 'manual',
      note: input.reason.trim(),
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, message: '勤怠の追加に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'attendance.manual_add',
    p_target_table: 'time_entries',
    p_target_id: inserted.id,
    p_before: null,
    p_after: { work_date: input.workDate, entry_type: input.entryType },
    p_note: input.reason.trim(),
  });

  revalidatePath('/app/attendance');
  return { ok: true, message: '勤怠を追加しました' };
}
