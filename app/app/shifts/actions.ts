'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

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
    const { error } = await supabase
      .from('shifts')
      .update({
        start_time: input.startTime,
        end_time: input.endTime,
        kind: input.kind,
        updated_by: ctx.userId,
      })
      .eq('id', input.id);
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
