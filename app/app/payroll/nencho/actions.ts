'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { nenchoDataSchema, type NenchoData } from './schema';

type ActionResult = { ok: boolean; message: string };

const EDITABLE_STATUSES = ['draft', 'needs_fix'];

// ---------------------------------------------------------------
// 本人: 下書き保存・提出
// ---------------------------------------------------------------

export interface SaveNenchoDraftInput {
  year: number;
  data: NenchoData;
}

export async function saveNenchoDraft(input: SaveNenchoDraftInput): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { ok: false, message: '対象年が正しくありません' };
  }
  const parsed = nenchoDataSchema.safeParse(input.data);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('nencho_declarations')
    .select('id, status')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('year', input.year)
    .maybeSingle();

  if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
    return { ok: false, message: 'この申告は提出済みのため編集できません' };
  }

  const payload = {
    organization_id: ctx.organizationId,
    profile_id: ctx.userId,
    year: input.year,
    status: 'draft',
    data: parsed.data,
    updated_by: ctx.userId,
  };

  const { error } = existing
    ? await supabase.from('nencho_declarations').update(payload).eq('id', existing.id)
    : await supabase.from('nencho_declarations').insert({ ...payload, created_by: ctx.userId });
  if (error) return { ok: false, message: `保存に失敗しました: ${error.message}` };

  revalidatePath('/app/payroll/nencho');
  return { ok: true, message: '下書きを保存しました' };
}

export async function submitNencho(year: number): Promise<ActionResult> {
  const ctx = await requireMember();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('nencho_declarations')
    .select('id, status')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('year', year)
    .maybeSingle();
  if (!existing) return { ok: false, message: '先に下書きを保存してください' };
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return { ok: false, message: 'この申告は既に提出済みです' };
  }

  const { error } = await supabase
    .from('nencho_declarations')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', existing.id);
  if (error) return { ok: false, message: `提出に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'nencho.submit',
    p_target_table: 'nencho_declarations',
    p_target_id: existing.id,
    p_before: { status: existing.status },
    p_after: { status: 'submitted' },
    p_note: `${year}年分の年末調整申告を提出`,
  });

  revalidatePath('/app/payroll/nencho');
  return { ok: true, message: '申告書を提出しました' };
}

// ---------------------------------------------------------------
// 管理（payroll.manage）: 確認フロー
// ---------------------------------------------------------------

export async function setNenchoReviewing(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('nencho_declarations')
    .select('status')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!existing) return { ok: false, message: '申告が見つかりません' };
  if (existing.status !== 'submitted') return { ok: false, message: '提出済みの申告のみ確認中にできます' };

  const { error } = await supabase
    .from('nencho_declarations')
    .update({ status: 'reviewing', updated_by: ctx.userId })
    .eq('id', id);
  if (error) return { ok: false, message: '更新に失敗しました' };

  revalidatePath('/app/payroll/nencho');
  return { ok: true, message: '確認中にしました' };
}

export async function confirmNencho(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('nencho_declarations')
    .select('status')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!existing) return { ok: false, message: '申告が見つかりません' };
  if (!['submitted', 'reviewing'].includes(existing.status)) {
    return { ok: false, message: '確認中の申告のみ確認済みにできます' };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('nencho_declarations')
    .update({ status: 'confirmed', confirmed_at: now, reviewed_by: ctx.userId, reviewed_at: now, updated_by: ctx.userId })
    .eq('id', id);
  if (error) return { ok: false, message: '更新に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'nencho.confirm',
    p_target_table: 'nencho_declarations',
    p_target_id: id,
    p_before: { status: existing.status },
    p_after: { status: 'confirmed' },
    p_note: null,
  });

  revalidatePath('/app/payroll/nencho');
  return { ok: true, message: '確認済みにしました' };
}

export async function rejectNencho(id: string, note: string): Promise<ActionResult> {
  const ctx = await requirePermission('payroll.manage');
  if (!note.trim()) return { ok: false, message: '差戻し理由を入力してください' };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('nencho_declarations')
    .select('status')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!existing) return { ok: false, message: '申告が見つかりません' };
  if (!['submitted', 'reviewing'].includes(existing.status)) {
    return { ok: false, message: '提出済みの申告のみ差し戻せます' };
  }

  const { error } = await supabase
    .from('nencho_declarations')
    .update({
      status: 'needs_fix',
      review_note: note.trim(),
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      updated_by: ctx.userId,
    })
    .eq('id', id);
  if (error) return { ok: false, message: '更新に失敗しました' };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'nencho.reject',
    p_target_table: 'nencho_declarations',
    p_target_id: id,
    p_before: { status: existing.status },
    p_after: { status: 'needs_fix' },
    p_note: note.trim(),
  });

  revalidatePath('/app/payroll/nencho');
  return { ok: true, message: '差し戻しました' };
}
