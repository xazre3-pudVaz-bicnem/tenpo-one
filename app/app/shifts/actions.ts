'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { can } from '@/lib/permissions';

type ActionResult = { ok: boolean; message: string };

export type ShiftKind = 'planned' | 'requested' | 'confirmed';

export interface UpsertShiftInput {
  id?: string;
  storeId: string;
  profileId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  kind: ShiftKind;
}

/** シフトの作成・更新（shifts.manage 権限者のみ） */
export async function upsertShift(input: UpsertShiftInput): Promise<ActionResult> {
  const ctx = await requirePermission('shifts.manage');
  if (input.startTime >= input.endTime) {
    return { ok: false, message: '終了時刻は開始時刻より後にしてください' };
  }
  const supabase = await createClient();

  if (input.id) {
    const { data: existing } = await supabase.from('shifts').select('status').eq('id', input.id).maybeSingle();
    const payload: Record<string, unknown> = {
      start_time: input.startTime,
      end_time: input.endTime,
      kind: input.kind,
      updated_by: ctx.userId,
    };
    // 変更申請(change_requested)は管理者の編集で解消し、公開状態へ戻す
    if (existing?.status === 'change_requested') {
      payload.status = 'published';
      payload.note = null;
    }
    const { error } = await supabase.from('shifts').update(payload).eq('id', input.id);
    if (error) return { ok: false, message: 'シフトの更新に失敗しました' };
  } else {
    const { error } = await supabase.from('shifts').insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      profile_id: input.profileId,
      shift_date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      kind: input.kind,
      status: 'draft',
      created_by: ctx.userId,
    });
    if (error) return { ok: false, message: 'シフトの作成に失敗しました' };
  }

  revalidatePath('/app/shifts');
  return { ok: true, message: 'シフトを保存しました' };
}

/** シフトの削除（shifts.manage 権限者のみ） */
export async function deleteShift(id: string): Promise<ActionResult> {
  await requirePermission('shifts.manage');
  const supabase = await createClient();
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) return { ok: false, message: 'シフトの削除に失敗しました' };
  revalidatePath('/app/shifts');
  return { ok: true, message: 'シフトを削除しました' };
}

/** 当週分の draft シフトを一括公開する */
export async function publishWeek(storeId: string, weekStart: string, weekEnd: string): Promise<ActionResult> {
  await requirePermission('shifts.manage');
  const supabase = await createClient();
  const { error } = await supabase
    .from('shifts')
    .update({ status: 'published' })
    .eq('store_id', storeId)
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd)
    .eq('status', 'draft');
  if (error) return { ok: false, message: '公開に失敗しました' };
  revalidatePath('/app/shifts');
  return { ok: true, message: '今週分のシフトを公開しました' };
}

export interface RequestShiftInput {
  id?: string;
  storeId: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** スタッフ本人によるシフト希望の提出 */
export async function requestShift(input: RequestShiftInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (input.startTime >= input.endTime) {
    return { ok: false, message: '終了時刻は開始時刻より後にしてください' };
  }
  const supabase = await createClient();

  if (input.id) {
    const { data: existing } = await supabase.from('shifts').select('profile_id, kind').eq('id', input.id).single();
    if (!existing || existing.profile_id !== ctx.userId || existing.kind !== 'requested') {
      return { ok: false, message: 'この希望は編集できません' };
    }
    const { error } = await supabase
      .from('shifts')
      .update({ start_time: input.startTime, end_time: input.endTime, updated_by: ctx.userId })
      .eq('id', input.id);
    if (error) return { ok: false, message: '希望の更新に失敗しました' };
  } else {
    const { error } = await supabase.from('shifts').insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      profile_id: ctx.userId,
      shift_date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      kind: 'requested',
      status: 'published',
      created_by: ctx.userId,
    });
    if (error) return { ok: false, message: '希望の送信に失敗しました' };
  }

  revalidatePath('/app/shifts');
  return { ok: true, message: '希望を提出しました' };
}

// ---------------------------------------------------------------
// シフト変更申請（一般スタッフ → shifts.manage 権限者が解消）
// ---------------------------------------------------------------

export interface ShiftChangeRequestInput {
  shiftId: string;
  dayOff: boolean;
  desiredStart: string | null; // HH:mm（休み希望時は null）
  desiredEnd: string | null;
  reason: string;
}

/**
 * 公開済みの自分のシフトに対する変更申請。
 * shifts テーブルの書込RLSは店長以上ロール限定のため、本人の申請登録は
 * サーバー側で所有者・状態を検証した上で管理クライアントを用いて行う。
 * shifts.status='change_requested' + note に希望内容を追記する簡易フロー。
 */
export async function requestShiftChange(input: ShiftChangeRequestInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!can(ctx.role, 'attendance.punch')) return { ok: false, message: '権限がありません' };
  if (!input.reason.trim()) return { ok: false, message: '理由を入力してください' };
  if (!input.dayOff) {
    if (!input.desiredStart || !input.desiredEnd || input.desiredStart >= input.desiredEnd) {
      return { ok: false, message: '希望時間を正しく入力してください' };
    }
  }

  const admin = createAdminClient();
  const { data: shift } = await admin
    .from('shifts')
    .select('id, profile_id, organization_id, status')
    .eq('id', input.shiftId)
    .maybeSingle();
  if (!shift || shift.profile_id !== ctx.userId || shift.organization_id !== ctx.organizationId) {
    return { ok: false, message: 'このシフトの変更申請はできません' };
  }
  if (shift.status !== 'published') {
    return { ok: false, message: '公開済みのシフトのみ変更申請できます' };
  }

  const summary = input.dayOff
    ? `休み希望 / 理由: ${input.reason.trim()}`
    : `変更希望: ${input.desiredStart}〜${input.desiredEnd} / 理由: ${input.reason.trim()}`;

  const { error } = await admin
    .from('shifts')
    .update({ status: 'change_requested', note: summary, updated_by: ctx.userId })
    .eq('id', input.shiftId);
  if (error) return { ok: false, message: '変更申請の送信に失敗しました' };

  revalidatePath('/app/shifts');
  return { ok: true, message: '変更申請を送信しました' };
}

/** 変更申請の却下（shifts.manage 権限者のみ）。公開状態へ戻し希望内容をクリアする。 */
export async function rejectShiftChange(shiftId: string): Promise<ActionResult> {
  await requirePermission('shifts.manage');
  const supabase = await createClient();
  const { error } = await supabase.from('shifts').update({ status: 'published', note: null }).eq('id', shiftId);
  if (error) return { ok: false, message: '却下に失敗しました' };
  revalidatePath('/app/shifts');
  return { ok: true, message: '変更申請を却下しました' };
}

// ---------------------------------------------------------------
// 時間帯別必要人数（shift_requirements）
// ---------------------------------------------------------------

export interface ShiftRequirementInput {
  storeId: string;
  dayOfWeek: number; // 0=日 〜 6=土
  timeFrom: string; // HH:mm
  timeTo: string; // HH:mm
  requiredCount: number;
}

/** 曜日・時間帯ごとの必要人数を追加する（shifts.manage 権限者のみ） */
export async function saveShiftRequirement(input: ShiftRequirementInput): Promise<ActionResult> {
  const ctx = await requirePermission('shifts.manage');
  if (input.timeFrom >= input.timeTo) return { ok: false, message: '終了時刻は開始時刻より後にしてください' };
  if (input.requiredCount < 1) return { ok: false, message: '必要人数は1以上で入力してください' };

  const supabase = await createClient();
  const { error } = await supabase.from('shift_requirements').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    day_of_week: input.dayOfWeek,
    time_from: input.timeFrom,
    time_to: input.timeTo,
    required_count: input.requiredCount,
    created_by: ctx.userId,
  });
  if (error) return { ok: false, message: '必要人数設定の保存に失敗しました' };
  revalidatePath('/app/shifts');
  return { ok: true, message: '必要人数設定を追加しました' };
}

/** 必要人数設定の削除（shifts.manage 権限者のみ） */
export async function deleteShiftRequirement(id: string): Promise<ActionResult> {
  await requirePermission('shifts.manage');
  const supabase = await createClient();
  const { error } = await supabase.from('shift_requirements').delete().eq('id', id);
  if (error) return { ok: false, message: '削除に失敗しました' };
  revalidatePath('/app/shifts');
  return { ok: true, message: '必要人数設定を削除しました' };
}
