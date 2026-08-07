'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveApprovalRule, checkApproval, type ApprovalRuleLike } from '@/lib/approvals';
import type { PaidVia } from '@/components/cash/labels';

/** 組織の承認ルール（target='expense'）をApprovalRuleLike形式で取得 */
async function loadExpenseApprovalRules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
): Promise<ApprovalRuleLike[]> {
  const { data } = await supabase
    .from('approval_rules')
    .select('target, min_amount, max_amount, approver_role, allow_self_approve')
    .eq('organization_id', organizationId)
    .eq('target', 'expense');
  return (data ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));
}

const DEFAULT_ACCOUNTS = [
  { code: '511', name: '食材費' },
  { code: '521', name: '消耗品費' },
  { code: '531', name: '水道光熱費' },
  { code: '541', name: '修繕費' },
  { code: '599', name: '雑費' },
];

/** 経費登録。支払元が小口現金の場合は cash_transactions(petty_out) も同時に作成し紐付ける */
export async function addExpense(input: {
  storeId: string;
  expenseAccountId: string;
  amount: number;
  taxAmount: number;
  paidVia: PaidVia;
  vendorName: string;
  memo: string;
  businessDate: string;
}) {
  const ctx = await requirePermission('cash.write');
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('金額は1円以上の整数で入力してください');
  }
  if (!Number.isInteger(input.taxAmount) || input.taxAmount < 0) {
    throw new Error('税額は0以上の整数で入力してください');
  }
  if (!input.expenseAccountId) throw new Error('勘定科目を選択してください');
  if (!input.businessDate) throw new Error('営業日を入力してください');

  const supabase = await createClient();

  let cashTransactionId: string | null = null;
  if (input.paidVia === 'petty_cash') {
    const { data: account } = await supabase
      .from('expense_accounts')
      .select('name')
      .eq('id', input.expenseAccountId)
      .single();
    const purpose = `${account?.name ?? '経費'}${input.memo.trim() ? '：' + input.memo.trim() : ''}`;

    const { data: tx, error: txError } = await supabase
      .from('cash_transactions')
      .insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        register_session_id: null,
        kind: 'petty_out',
        amount: input.amount,
        purpose,
        expense_account_id: input.expenseAccountId,
        approval_status: 'pending',
        business_date: input.businessDate,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id')
      .single();
    if (txError) throw new Error(txError.message);
    cashTransactionId = tx.id;
  }

  const { error } = await supabase.from('expenses').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    expense_account_id: input.expenseAccountId,
    amount: input.amount,
    tax_amount: input.taxAmount,
    paid_via: input.paidVia,
    vendor_name: input.vendorName.trim() || null,
    memo: input.memo.trim() || null,
    cash_transaction_id: cashTransactionId,
    business_date: input.businessDate,
    approval_status: 'pending',
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/app/expenses');
  if (cashTransactionId) revalidatePath('/app/cash');
}

/** 経費の承認。小口現金払いの場合は紐付く cash_transactions も同時に承認する */
export async function approveExpense(id: string) {
  const ctx = await requirePermission('cash.approve');
  const supabase = await createClient();
  const { data: exp } = await supabase
    .from('expenses')
    .select('organization_id, store_id, approval_status, cash_transaction_id, amount, created_by')
    .eq('id', id)
    .single();
  if (!exp) throw new Error('経費が見つかりません');
  if (exp.approval_status !== 'pending') throw new Error('承認待ちの経費のみ承認できます');

  const rules = await loadExpenseApprovalRules(supabase, exp.organization_id);
  const rule = resolveApprovalRule(rules, 'expense', exp.amount);
  const check = checkApproval(rule, ctx.role, exp.created_by === ctx.userId);
  if (!check.allowed) {
    if (check.reason === 'insufficient_role') throw new Error(`この金額は${check.requiredRoleLabel}の承認が必要です`);
    throw new Error('自分の登録した経費は承認できません（設定で変更可能）');
  }

  const { error } = await supabase
    .from('expenses')
    .update({ approval_status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: exp.organization_id,
    p_store: exp.store_id,
    p_action: 'expense.approve',
    p_target_table: 'expenses',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'approved' },
    p_note: null,
  });

  if (exp.cash_transaction_id) {
    await supabase
      .from('cash_transactions')
      .update({ approval_status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', exp.cash_transaction_id);
    await supabase.rpc('log_audit', {
      p_org: exp.organization_id,
      p_store: exp.store_id,
      p_action: 'cash_transaction.approve',
      p_target_table: 'cash_transactions',
      p_target_id: exp.cash_transaction_id,
      p_before: { approval_status: 'pending' },
      p_after: { approval_status: 'approved' },
      p_note: '経費承認に連動',
    });
    revalidatePath('/app/cash');
  }
  revalidatePath('/app/expenses');
}

/** 経費の差戻し（理由必須）。紐付く cash_transactions も同時に差戻しする */
export async function rejectExpense(id: string, reason: string) {
  const ctx = await requirePermission('cash.approve');
  if (!reason.trim()) throw new Error('差戻し理由を入力してください');

  const supabase = await createClient();
  const { data: exp } = await supabase
    .from('expenses')
    .select('organization_id, store_id, approval_status, cash_transaction_id, amount, created_by')
    .eq('id', id)
    .single();
  if (!exp) throw new Error('経費が見つかりません');
  if (exp.approval_status !== 'pending') throw new Error('承認待ちの経費のみ差戻しできます');

  const rules = await loadExpenseApprovalRules(supabase, exp.organization_id);
  const rule = resolveApprovalRule(rules, 'expense', exp.amount);
  const check = checkApproval(rule, ctx.role, exp.created_by === ctx.userId);
  if (!check.allowed) {
    if (check.reason === 'insufficient_role') throw new Error(`この金額は${check.requiredRoleLabel}の承認が必要です`);
    throw new Error('自分の登録した経費は差戻しできません（設定で変更可能）');
  }

  const { error } = await supabase
    .from('expenses')
    .update({ approval_status: 'rejected', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: exp.organization_id,
    p_store: exp.store_id,
    p_action: 'expense.reject',
    p_target_table: 'expenses',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'rejected' },
    p_note: reason.trim(),
  });

  if (exp.cash_transaction_id) {
    await supabase
      .from('cash_transactions')
      .update({ approval_status: 'rejected', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', exp.cash_transaction_id);
    await supabase.rpc('log_audit', {
      p_org: exp.organization_id,
      p_store: exp.store_id,
      p_action: 'cash_transaction.reject',
      p_target_table: 'cash_transactions',
      p_target_id: exp.cash_transaction_id,
      p_before: { approval_status: 'pending' },
      p_after: { approval_status: 'rejected' },
      p_note: reason.trim(),
    });
    revalidatePath('/app/cash');
  }
  revalidatePath('/app/expenses');
}

/** 初期科目一括作成（組織に勘定科目が0件のときのみ有効） */
export async function seedExpenseAccounts() {
  const ctx = await requirePermission('cash.approve');
  const supabase = await createClient();
  const { count } = await supabase
    .from('expense_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.organizationId);
  if (count && count > 0) {
    throw new Error('すでに勘定科目が登録されています');
  }

  const { error } = await supabase.from('expense_accounts').insert(
    DEFAULT_ACCOUNTS.map((a, i) => ({
      organization_id: ctx.organizationId,
      code: a.code,
      name: a.name,
      sort_order: i,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }))
  );
  if (error) throw new Error(error.message);
  revalidatePath('/app/expenses');
}
