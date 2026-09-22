'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  MAX_DYNAMIC_RULES,
  dynamicRuleProblem,
  normalizeDynamicRule,
  type DynamicPriceRule,
} from '@/lib/dynamic-pricing';

export interface ActionResult {
  error?: string;
}

/** ダイナミックプライシングのルールを保存（store_settings.settings.dynamicPricing。上から順に優先） */
export async function saveDynamicPricing(storeId: string, input: DynamicPriceRule[]): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  if (!Array.isArray(input) || input.length > MAX_DYNAMIC_RULES) {
    return { error: `ルールは${MAX_DYNAMIC_RULES}件までです` };
  }

  const rules: DynamicPriceRule[] = [];
  for (const raw of input) {
    const r = normalizeDynamicRule(raw);
    if (!r) return { error: 'ルールの内容が正しくありません（名前・時間・値を確認してください）' };
    const problem = dynamicRuleProblem(r);
    if (problem) return { error: problem };
    rules.push(r);
  }
  if (new Set(rules.map((r) => r.id)).size !== rules.length) return { error: 'ルールが重複しています' };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, dynamicPricing: { rules } },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `ダイナミックプライシングの保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.menu.dynamic_pricing',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: { rules: rules.length, enabled: rules.filter((r) => r.enabled).length },
    p_note: null,
  });

  revalidatePath('/app/settings/dynamic-pricing');
  revalidatePath('/app/pos');
  revalidatePath('/handy', 'layout');
  revalidatePath('/order', 'layout');
  return {};
}
