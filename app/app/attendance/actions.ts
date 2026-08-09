'use server';

import { scryptSync, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { can } from '@/lib/permissions';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { todayJst } from '@/lib/format';
import {
  isPayrollLocked,
  findLockingPayrollRun,
  PAYROLL_LOCKED_MESSAGE,
  jstToIso,
  insertLeaveTimeEntry,
  calcLeaveRemaining,
  canReviewRequests,
  mapDbErrorMessage,
} from './shared';

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

/** IPベースのレート制限キー取得用（x-forwarded-for優先、無ければx-real-ip） */
async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const PIN_HASH_PREFIX = 'scrypt';

function isHashedPin(value: string): boolean {
  return value.startsWith(`${PIN_HASH_PREFIX}$`);
}

/**
 * 打刻用PINの照合。profiles.pin_code はハッシュ形式（`scrypt$<saltHex>$<hashHex>`）で保存されるが、
 * 未移行の既存レコードは平文のままの可能性があるため後方互換で平文比較にフォールバックする
 * （store/staff/actions.ts の setMemberPin で次回PIN設定時に自動的にハッシュへ移行される）。
 */
function verifyPin(inputPin: string, stored: string): boolean {
  if (!isHashedPin(stored)) {
    // レガシー平文PIN: タイミング攻撃を避けるため timingSafeEqual で比較する
    const a = Buffer.from(inputPin);
    const b = Buffer.from(stored);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(inputPin, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

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
  // apply_punch はSECURITY DEFINERで、本人打刻(p_profile_id=auth.uid())の場合は
  // 店舗の組織所属を検証しないため、ここでアクセス可能店舗かを必ず確認する
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return { ok: false, message: 'この店舗での打刻はできません' };
  }
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
  // p_via_pin=true の場合 apply_punch は組織所属チェックを一切行わないため、
  // 共用端末を操作している本人がアクセス可能な店舗かを必ずここで検証する
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return { ok: false, message: 'この店舗での打刻はできません' };
  }

  // ブルートフォース対策: 店舗×時間窓で試行回数を制限する（PIN空間が4〜6桁と狭いため）。
  // ※ インメモリ実装のため複数インスタンス構成では制限が不完全（lib/rate-limit.ts参照）。
  const ip = await requestIp();
  if (
    !rateLimiter.check(`pin-punch:${storeId}`, RATE_LIMITS.pinPunch.limit, RATE_LIMITS.pinPunch.windowMs) ||
    !rateLimiter.check(`pin-punch-ip:${ip}`, RATE_LIMITS.pinPunch.limit, RATE_LIMITS.pinPunch.windowMs)
  ) {
    return { ok: false, message: '試行回数が多すぎます。しばらく待ってから再度お試しください' };
  }

  const admin = createAdminClient();

  const { data: memberships, error: findError } = await admin
    .from('memberships')
    .select('profile_id, profiles!inner(id, display_name, pin_code, status)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');

  if (findError) return { ok: false, message: 'スタッフ照合に失敗しました' };

  type Row = { profile_id: string; profiles: { id: string; display_name: string; pin_code: string | null; status: string } | null };
  const match = ((memberships ?? []) as unknown as Row[]).find(
    (m) => m.profiles && m.profiles.status === 'active' && m.profiles.pin_code && verifyPin(pin, m.profiles.pin_code)
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

/**
 * 勤怠修正申請の作成（本人 or attendance.approve 権限者が代理登録）。
 * 給与確定期間ロック後の唯一の修正経路のため、ロック中の日でも申請自体は常に可能にする
 * （ロック判定・実際の反映可否は承認時に行う）。
 */
export async function requestCorrection(input: CorrectionInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!can(ctx.role, 'attendance.punch')) {
    return { ok: false, message: '権限がありません' };
  }
  if (input.profileId !== ctx.userId && !can(ctx.role, 'attendance.approve')) {
    return { ok: false, message: '本人以外の修正申請はできません' };
  }
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '担当外の店舗です' };
  }
  if (!input.reason.trim()) {
    return { ok: false, message: '理由を入力してください' };
  }

  const supabase = await createClient();
  const requestedChanges = {
    clock_in_at: jstToIso(input.workDate, input.desiredClockIn),
    clock_out_at: jstToIso(input.workDate, input.desiredClockOut),
    break_minutes: input.breakMinutes,
  };

  const { data: inserted, error } = await supabase
    .from('attendance_correction_requests')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      profile_id: input.profileId,
      time_entry_id: input.timeEntryId,
      work_date: input.workDate,
      requested_changes: requestedChanges,
      reason: input.reason.trim(),
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !inserted) return { ok: false, message: '修正申請の送信に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'attendance.correction_request',
    p_target_table: 'attendance_correction_requests',
    p_target_id: inserted.id,
    p_before: null,
    p_after: requestedChanges,
    p_note: input.reason.trim(),
  });

  revalidatePath('/app/attendance');
  return { ok: true, message: '修正申請を送信しました' };
}

/**
 * 修正申請の承認: time_entries を反映し監査ログを記録する。
 * 対象日が給与確定期間ロック中の場合でも、この経路（修正申請の承認）に限り time_entries の
 * 更新自体は行う（＝締め後の唯一の修正経路）。ただし対象runの状態に応じて案内メッセージを変える。
 *   - ロック対象runなし／下書き: 通常反映（下書きなら再計算が必要）
 *   - confirmed（承認前）: 反映するが、再計算するには一旦下書きに戻す操作が必要と案内
 *   - approved（確定済み）: 反映するが、確定済みの給与額自体は変わらないため次回給与での
 *     調整を促す（給与明細を勝手に書き換えない）
 */
export async function approveRequest(requestId: string): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!canReviewRequests(ctx.role)) return { ok: false, message: 'この操作を行う権限がありません' };
  const supabase = await createClient();

  const { data: request, error: fetchError } = await supabase
    .from('attendance_correction_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (fetchError || !request) return { ok: false, message: '申請が見つかりません' };
  if (!ctx.stores.some((s) => s.id === request.store_id)) return { ok: false, message: '担当外の店舗です' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const changes = request.requested_changes as {
    clock_in_at: string;
    clock_out_at: string;
    break_minutes: number;
  };
  const workDate = request.work_date as string;

  const lockingRun = await findLockingPayrollRun(supabase, ctx.organizationId, request.store_id, workDate);

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
    if (updateError) return { ok: false, message: mapDbErrorMessage(updateError.message, '勤怠記録の更新に失敗しました') };
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('time_entries')
      .insert({
        organization_id: ctx.organizationId,
        store_id: request.store_id,
        profile_id: request.profile_id,
        work_date: workDate,
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
    if (insertError || !inserted) return { ok: false, message: mapDbErrorMessage(insertError?.message, '勤怠記録の作成に失敗しました') };
    targetId = inserted.id;
  }

  await supabase
    .from('attendance_correction_requests')
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
    p_action: 'attendance.correction_approve',
    p_target_table: 'attendance_correction_requests',
    p_target_id: requestId,
    p_before: before,
    p_after: changes,
    p_note: `勤怠修正申請を承認 (${workDate})`,
  });

  revalidatePath('/app/attendance');
  revalidatePath('/app/payroll');

  if (!lockingRun) {
    return { ok: true, message: '修正申請を承認し、勤怠記録に反映しました' };
  }
  if (lockingRun.status === 'confirmed') {
    return {
      ok: true,
      warning: true,
      message: `勤怠記録に反映しました。給与計算「${lockingRun.title}」は確定済み（承認前）のため、金額に反映するには一旦「下書きに戻す」操作をしてから再計算してください`,
    };
  }
  // approved
  return {
    ok: true,
    warning: true,
    message: `勤怠記録のみ反映しました。給与計算「${lockingRun.title}」はすでに承認済みのため金額は自動的には変わりません。差額は次回の給与計算での調整をご検討ください`,
  };
}

/** 修正申請の却下 */
export async function rejectRequest(requestId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!canReviewRequests(ctx.role)) return { ok: false, message: 'この操作を行う権限がありません' };
  if (!reason.trim()) return { ok: false, message: '却下理由を入力してください' };
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('attendance_correction_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!request) return { ok: false, message: '申請が見つかりません' };
  if (!ctx.stores.some((s) => s.id === request.store_id)) return { ok: false, message: '担当外の店舗です' };
  if (request.status !== 'pending') return { ok: false, message: 'この申請はすでに処理済みです' };

  const { error } = await supabase
    .from('attendance_correction_requests')
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
    p_action: 'attendance.correction_reject',
    p_target_table: 'attendance_correction_requests',
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
  /** 有給の取得区分（entryType='paid_leave' の場合のみ）。全休=1 / 半休=0.5。未指定時は全休扱い */
  leaveFraction?: 1 | 0.5;
}

/**
 * 打刻なしの勤怠（有給・欠勤）を手動追加する（attendance.approve 権限者のみ）。
 * clock_in_at / clock_out_at は null のまま status='approved' で登録する。
 * entryType='paid_leave' の場合は time_entries.leave_fraction に取得区分（全休1.0/半休0.5）を保存する。
 */
export async function addManualEntry(input: ManualEntryInput): Promise<ActionResult> {
  const ctx = await requirePermission('attendance.approve');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { ok: false, message: '担当外の店舗です' };
  }
  if (!input.profileId) return { ok: false, message: '対象スタッフを選択してください' };
  if (!input.workDate) return { ok: false, message: '日付を入力してください' };
  if (input.entryType !== 'paid_leave' && input.entryType !== 'absent') {
    return { ok: false, message: '区分が正しくありません' };
  }
  if (!input.reason.trim()) return { ok: false, message: '理由を入力してください' };
  if (input.leaveFraction != null && input.leaveFraction !== 1 && input.leaveFraction !== 0.5) {
    return { ok: false, message: '取得区分が正しくありません' };
  }

  const supabase = await createClient();

  if (await isPayrollLocked(supabase, ctx.organizationId, input.storeId, input.workDate)) {
    return { ok: false, message: PAYROLL_LOCKED_MESSAGE };
  }

  const leaveFraction = input.entryType === 'paid_leave' ? (input.leaveFraction ?? 1) : null;

  let insertedId: string;
  if (input.entryType === 'paid_leave') {
    const result = await insertLeaveTimeEntry(supabase, {
      organizationId: ctx.organizationId,
      storeId: input.storeId,
      profileId: input.profileId,
      workDate: input.workDate,
      leaveFraction: leaveFraction as 1 | 0.5,
      note: input.reason.trim(),
      approvedBy: ctx.userId,
    });
    if ('error' in result) return { ok: false, message: mapDbErrorMessage(result.error, '勤怠の追加に失敗しました') };
    insertedId = result.id;
  } else {
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
        leave_fraction: null,
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
    insertedId = inserted.id;
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'attendance.manual_add',
    p_target_table: 'time_entries',
    p_target_id: insertedId,
    p_before: null,
    p_after: { work_date: input.workDate, entry_type: input.entryType, leave_fraction: leaveFraction },
    p_note: input.reason.trim(),
  });

  revalidatePath('/app/attendance');
  revalidatePath('/app/leave');

  // 有給の場合、残日数不足の簡易チェック（登録は妨げない・注記のみ）。
  // 残日数 = 有効な付与合計（失効日が本日以降）− 取得合計（本追加分を含む）
  if (input.entryType === 'paid_leave') {
    const remaining = await calcLeaveRemaining(supabase, ctx.organizationId, input.profileId, todayJst());
    if (remaining < 0) {
      return { ok: true, message: '勤怠を追加しました（有給の残日数が不足している可能性があります）', warning: true };
    }
  }

  return { ok: true, message: '勤怠を追加しました' };
}
