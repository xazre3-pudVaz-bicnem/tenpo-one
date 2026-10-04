'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  canEditMonthlyCosts,
  isEmptyMonthlyCosts,
  isMonthKey,
  MAX_OTHER_COSTS,
  normalizeMonthlyCosts,
  type MonthlyCosts,
} from '@/lib/monthly-settlement';

export interface ActionResult {
  error?: string;
}

/**
 * ある店・ある月の 家賃・電気・水道・給料・その他 を保存する（store_settings.settings.monthlyCosts[YYYY-MM]）。
 * settings の他の項目は消さない。全部 0 にしたら、その月の項目は消す。
 */
export async function saveMonthlyCosts(storeId: string, month: string, input: MonthlyCosts): Promise<ActionResult> {
  const ctx = await requirePermission('reports.view');
  if (ctx.isRegisterDevice) return { error: '固定費・給料は管理画面（パソコン）から入れてください' };
  if (!canEditMonthlyCosts(ctx)) return { error: '固定費・給料は本部（契約企業オーナー・本社管理者・本社経理）だけが入れられます' };
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: '対象店舗にアクセス権がありません' };
  if (!isMonthKey(month)) return { error: '月の指定が正しくありません' };
  if (Array.isArray(input?.other) && input.other.length > MAX_OTHER_COSTS) {
    return { error: `その他の費用は${MAX_OTHER_COSTS}件までです` };
  }
  const costs = normalizeMonthlyCosts(input);

  const supabase = await createClient();
  const { data: existing } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const allMonths = ((current.monthlyCosts as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const before = allMonths[month] ?? null;
  const nextMonths: Record<string, unknown> = { ...allMonths };
  if (isEmptyMonthlyCosts(costs)) delete nextMonths[month];
  else nextMonths[month] = costs;
  const nextSettings: Record<string, unknown> = { ...current };
  if (Object.keys(nextMonths).length > 0) nextSettings.monthlyCosts = nextMonths;
  else delete nextSettings.monthlyCosts;

  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `固定費・給料の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settlement.monthly_costs_update',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: { month, costs: before },
    p_after: { month, costs: isEmptyMonthlyCosts(costs) ? null : costs },
    p_note: null,
  });

  revalidatePath('/app/settlement');
  return {};
}
