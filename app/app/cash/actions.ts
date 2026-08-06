'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function assertPositiveInt(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}は1円以上の整数で入力してください`);
  }
}

/** レジ開局（open_register_session RPC） */
export async function openRegister(storeId: string, registerId: string, openingFloat: number) {
  await requirePermission('register.operate');
  if (!Number.isInteger(openingFloat) || openingFloat < 0) {
    throw new Error('釣銭準備金は0以上の整数で入力してください');
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('open_register_session', {
    p_store_id: storeId,
    p_register_id: registerId,
    p_opening_float: openingFloat,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/** 開局中セッションへの中間入出金（deposit/withdrawal） */
export async function addCashTransaction(input: {
  storeId: string;
  registerSessionId: string;
  kind: 'deposit' | 'withdrawal';
  amount: number;
  purpose: string;
}) {
  const ctx = await requirePermission('register.operate');
  assertPositiveInt(input.amount, '金額');
  if (!input.purpose.trim()) throw new Error('用途を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.from('cash_transactions').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    register_session_id: input.registerSessionId,
    kind: input.kind,
    amount: input.amount,
    purpose: input.purpose.trim(),
    approval_status: 'approved',
    approved_by: ctx.userId,
    approved_at: new Date().toISOString(),
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/** レジ締め（close_register_session RPC。理論現金・差異はDB側で計算） */
export async function closeRegister(sessionId: string, countedCash: number, differenceReason: string | null) {
  await requirePermission('register.operate');
  if (!Number.isInteger(countedCash) || countedCash < 0) {
    throw new Error('実残高は0以上の整数で入力してください');
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('close_register_session', {
    p_session_id: sessionId,
    p_counted_cash: countedCash,
    p_difference_reason: differenceReason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/** 小口現金の入出金登録（承認待ちで作成） */
export async function addPettyCash(input: {
  storeId: string;
  kind: 'petty_in' | 'petty_out';
  amount: number;
  purpose: string;
  expenseAccountId: string | null;
}) {
  const ctx = await requirePermission('cash.write');
  assertPositiveInt(input.amount, '金額');
  if (!input.purpose.trim()) throw new Error('用途を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.from('cash_transactions').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    register_session_id: null,
    kind: input.kind,
    amount: input.amount,
    purpose: input.purpose.trim(),
    expense_account_id: input.expenseAccountId,
    approval_status: 'pending',
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/** 小口現金の承認 */
export async function approvePettyCash(id: string) {
  const ctx = await requirePermission('cash.approve');
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from('cash_transactions')
    .select('organization_id, store_id, approval_status')
    .eq('id', id)
    .single();
  if (!tx) throw new Error('対象の入出金が見つかりません');
  if (tx.approval_status !== 'pending') throw new Error('承認待ちの入出金のみ承認できます');

  const { error } = await supabase
    .from('cash_transactions')
    .update({ approval_status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: tx.organization_id,
    p_store: tx.store_id,
    p_action: 'cash_transaction.approve',
    p_target_table: 'cash_transactions',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'approved' },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

/** 小口現金の差戻し（理由必須） */
export async function rejectPettyCash(id: string, reason: string) {
  const ctx = await requirePermission('cash.approve');
  if (!reason.trim()) throw new Error('差戻し理由を入力してください');

  const supabase = await createClient();
  const { data: tx } = await supabase
    .from('cash_transactions')
    .select('organization_id, store_id, approval_status')
    .eq('id', id)
    .single();
  if (!tx) throw new Error('対象の入出金が見つかりません');
  if (tx.approval_status !== 'pending') throw new Error('承認待ちの入出金のみ差戻しできます');

  const { error } = await supabase
    .from('cash_transactions')
    .update({ approval_status: 'rejected', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: tx.organization_id,
    p_store: tx.store_id,
    p_action: 'cash_transaction.reject',
    p_target_table: 'cash_transactions',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'rejected' },
    p_note: reason.trim(),
  });
  revalidatePath('/app/cash');
}

/** 締め承認（closed/reopened → approved） */
export async function approveClosing(id: string) {
  const ctx = await requirePermission('register.approve');
  const supabase = await createClient();
  const { data: closing } = await supabase
    .from('daily_closings')
    .select('organization_id, store_id, status')
    .eq('id', id)
    .single();
  if (!closing) throw new Error('締めデータが見つかりません');
  if (!['closed', 'reopened'].includes(closing.status)) {
    throw new Error('承認できる状態ではありません');
  }

  const { error } = await supabase
    .from('daily_closings')
    .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: closing.organization_id,
    p_store: closing.store_id,
    p_action: 'daily_closing.approve',
    p_target_table: 'daily_closings',
    p_target_id: id,
    p_before: { status: closing.status },
    p_after: { status: 'approved' },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

/** 締め後修正（approved → reopened。数値は変更しない。理由必須） */
export async function reopenClosing(id: string, reason: string) {
  const ctx = await requirePermission('register.approve');
  if (!reason.trim()) throw new Error('修正理由を入力してください');

  const supabase = await createClient();
  const { data: closing } = await supabase
    .from('daily_closings')
    .select('organization_id, store_id, status, note')
    .eq('id', id)
    .single();
  if (!closing) throw new Error('締めデータが見つかりません');
  if (closing.status !== 'approved') throw new Error('承認済みの締めのみ修正できます');

  const noteEntry = `[締め後修正 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] ${reason.trim()}`;
  const nextNote = closing.note ? `${closing.note}\n${noteEntry}` : noteEntry;

  const { error } = await supabase
    .from('daily_closings')
    .update({ status: 'reopened', note: nextNote, updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: closing.organization_id,
    p_store: closing.store_id,
    p_action: 'daily_closing.reopen',
    p_target_table: 'daily_closings',
    p_target_id: id,
    p_before: { status: 'approved' },
    p_after: { status: 'reopened' },
    p_note: reason.trim(),
  });
  revalidatePath('/app/cash');
}
