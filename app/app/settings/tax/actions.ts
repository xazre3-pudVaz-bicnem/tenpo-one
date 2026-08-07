'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

export interface TaxRateInput {
  id?: string;
  name: string;
  rate: number;
  isReduced: boolean;
  isInclusive: boolean;
  isDefault: boolean;
}

/** 税率の追加・更新。既定にする場合は他の既定フラグを解除する */
export async function saveTaxRate(input: TaxRateInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');

  const name = input.name.trim();
  if (!name) return { error: '税率名を入力してください' };
  if (input.rate < 0 || input.rate > 100) return { error: '税率は0〜100の範囲で入力してください' };

  const supabase = await createClient();

  if (input.isDefault) {
    await supabase
      .from('tax_rates')
      .update({ is_default: false, updated_by: ctx.userId })
      .eq('organization_id', ctx.organizationId)
      .eq('is_default', true);
  }

  const payload = {
    organization_id: ctx.organizationId,
    name,
    rate: input.rate,
    is_reduced: input.isReduced,
    is_inclusive: input.isInclusive,
    is_default: input.isDefault,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase
      .from('tax_rates')
      .update(payload)
      .eq('id', input.id)
      .eq('organization_id', ctx.organizationId);
    if (error) return { error: `税率の更新に失敗しました: ${error.message}` };
  } else {
    const { error } = await supabase.from('tax_rates').insert({ ...payload, created_by: ctx.userId });
    if (error) return { error: `税率の追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: input.id ? 'settings.tax.update' : 'settings.tax.add',
    p_target_table: 'tax_rates',
    p_target_id: input.id ?? ctx.organizationId,
    p_before: null,
    p_after: { name, rate: input.rate, is_default: input.isDefault },
    p_note: null,
  });

  revalidatePath('/app/settings/tax');
  return {};
}

/** 税率の削除（履歴保全のため論理削除） */
export async function deleteTaxRate(id: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');

  const supabase = await createClient();
  const { error } = await supabase
    .from('tax_rates')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `税率の削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.tax.delete',
    p_target_table: 'tax_rates',
    p_target_id: id,
    p_before: null,
    p_after: { status: 'deleted' },
    p_note: null,
  });

  revalidatePath('/app/settings/tax');
  return {};
}
