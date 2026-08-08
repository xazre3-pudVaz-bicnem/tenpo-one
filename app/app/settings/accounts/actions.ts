'use server';

import { revalidatePath } from 'next/cache';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AccountCategory, TaxTreatment } from '@/lib/accounting';
import { canWriteAccounting } from '@/components/accounting/roles';
import { mapAccountingError } from '@/components/accounting/labels';

export interface ActionResult {
  error?: string;
}

const LIST_PATH = '/app/settings/accounts';

export interface AccountInput {
  id?: string;
  code: string;
  name: string;
  category: AccountCategory;
  subType: string | null;
  defaultTaxTreatment: TaxTreatment;
  sortOrder: number;
}

/** 勘定科目の追加・更新。is_system=true の科目はコード・カテゴリを変更しない（呼び出し側でも入力を無効化する） */
export async function saveAccount(input: AccountInput): Promise<ActionResult> {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) return { error: 'この操作を行う権限がありません' };

  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) return { error: 'コードを入力してください' };
  if (!name) return { error: '名称を入力してください' };
  if (!Number.isInteger(input.sortOrder)) return { error: '並び順は整数で入力してください' };

  const supabase = await createClient();

  let effectiveCode = code;
  let effectiveCategory = input.category;
  if (input.id) {
    // is_system の科目はコード・カテゴリを変更させない（クライアント側は無効化しているが、サーバー側でも強制する）
    const { data: existing } = await supabase.from('accounts').select('is_system, code, category').eq('id', input.id).eq('organization_id', ctx.organizationId).single();
    if (!existing) return { error: '科目が見つかりません' };
    if (existing.is_system) {
      effectiveCode = existing.code as string;
      effectiveCategory = existing.category as AccountCategory;
    }
  }

  const payload = {
    organization_id: ctx.organizationId,
    code: effectiveCode,
    name,
    category: effectiveCategory,
    sub_type: input.subType,
    default_tax_treatment: input.defaultTaxTreatment,
    sort_order: input.sortOrder,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase.from('accounts').update(payload).eq('id', input.id).eq('organization_id', ctx.organizationId);
    if (error) {
      if (error.code === '23505') return { error: `コード「${code}」は既に使用されています` };
      return { error: `科目の更新に失敗しました: ${error.message}` };
    }
    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId, p_store: null, p_action: 'accounting.account.update',
      p_target_table: 'accounts', p_target_id: input.id, p_before: null, p_after: { code: effectiveCode, name }, p_note: null,
    });
  } else {
    const { error } = await supabase.from('accounts').insert({ ...payload, is_system: false, created_by: ctx.userId });
    if (error) {
      if (error.code === '23505') return { error: `コード「${code}」は既に使用されています` };
      return { error: `科目の追加に失敗しました: ${error.message}` };
    }
    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId, p_store: null, p_action: 'accounting.account.add',
      p_target_table: 'accounts', p_target_id: code, p_before: null, p_after: { code, name }, p_note: null,
    });
  }

  revalidatePath(LIST_PATH);
  return {};
}

/** 勘定科目の削除（論理削除）。is_system の科目は削除不可 */
export async function deleteAccount(id: string): Promise<ActionResult> {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) return { error: 'この操作を行う権限がありません' };

  const supabase = await createClient();
  const { data: account } = await supabase.from('accounts').select('is_system, code, name').eq('id', id).eq('organization_id', ctx.organizationId).single();
  if (!account) return { error: '科目が見つかりません' };
  if (account.is_system) return { error: '標準科目は削除できません（名称の変更は可能です）' };

  const { error } = await supabase.from('accounts').update({ status: 'deleted', updated_by: ctx.userId }).eq('id', id).eq('organization_id', ctx.organizationId);
  if (error) return { error: `科目の削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId, p_store: null, p_action: 'accounting.account.delete',
    p_target_table: 'accounts', p_target_id: id, p_before: null, p_after: { status: 'deleted' }, p_note: null,
  });

  revalidatePath(LIST_PATH);
  return {};
}

/** 標準勘定科目テンプレートの導入（冪等・追加件数を返す） */
export async function installStandardAccounts(): Promise<{ count?: number; error?: string }> {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) return { error: 'この操作を行う権限がありません' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('install_standard_accounts', { p_org: ctx.organizationId });
  if (error) return { error: mapAccountingError(error.message) };

  revalidatePath(LIST_PATH);
  return { count: (data as number | null) ?? 0 };
}
