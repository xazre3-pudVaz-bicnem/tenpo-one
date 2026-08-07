'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ALERT_RULE_KEYS, type AlertRuleKey } from '@/components/dashboard/alert-rules';

const PATH = '/app/settings/alerts';

export interface AlertRuleInput {
  storeId: string | null; // null = 企業既定（本社のみ編集可）
  ruleKey: AlertRuleKey;
  threshold: number;
  enabled: boolean;
}

export async function upsertAlertRule(input: AlertRuleInput) {
  const ctx = await requirePermission('store.settings');
  if (!ALERT_RULE_KEYS.includes(input.ruleKey)) throw new Error('不正な項目です');
  if (!Number.isFinite(input.threshold) || input.threshold < 0) throw new Error('閾値を正しく入力してください');

  if (input.storeId === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') {
      throw new Error('企業既定の編集は本社管理者のみ行えます');
    }
  } else if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('担当外の店舗です');
  }

  const supabase = await createClient();
  let existingQuery = supabase
    .from('alert_rules')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('rule_key', input.ruleKey);
  existingQuery = input.storeId === null ? existingQuery.is('store_id', null) : existingQuery.eq('store_id', input.storeId);
  const { data: existing } = await existingQuery.maybeSingle();

  const payload = { threshold: input.threshold, enabled: input.enabled, updated_by: ctx.userId };
  const { error } = existing
    ? await supabase.from('alert_rules').update(payload).eq('id', existing.id)
    : await supabase.from('alert_rules').insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        rule_key: input.ruleKey,
        created_by: ctx.userId,
        ...payload,
      });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
  revalidatePath('/app/dashboard');
}

/** 店舗override削除（企業既定に戻す） */
export async function resetAlertRuleToDefault(storeId: string, ruleKey: AlertRuleKey) {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) throw new Error('担当外の店舗です');

  const supabase = await createClient();
  const { error } = await supabase
    .from('alert_rules')
    .delete()
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', storeId)
    .eq('rule_key', ruleKey);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
  revalidatePath('/app/dashboard');
}
