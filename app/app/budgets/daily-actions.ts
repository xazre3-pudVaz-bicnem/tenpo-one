'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cleanDailyBudgets, monthTotal, type DailyBudgetMap } from '@/lib/daily-budget';

/**
 * 日別の売上予算を保存する（2026-09-25 店舗要望）。
 * 日ごとの金額は店舗設定（store_settings.settings.dailyBudgets）に持ち、
 * 月の合計はこれまでの月次予算（budgets.sales_budget）にも書き戻すので、
 * レポートの予算対比はそのまま使える。
 */
export async function saveDailyBudgets(
  storeId: string,
  month: string,
  values: DailyBudgetMap
): Promise<{ error?: string; total?: number }> {
  const ctx = await requirePermission('store.settings');
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: '対象月が正しくありません' };
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { error: '担当外の店舗です' };

  const cleaned = cleanDailyBudgets(values ?? {}, month);
  const total = monthTotal(cleaned);
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const allMonths = ((current.dailyBudgets as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, dailyBudgets: { ...allMonths, [month]: cleaned } },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `日別予算の保存に失敗しました: ${error.message}` };

  // 月次予算（予算管理・レポートの予算対比）にも合計を入れておく
  const monthKey = `${month}-01`;
  const { data: row } = await supabase
    .from('budgets')
    .select('id')
    .eq('store_id', storeId)
    .eq('month', monthKey)
    .maybeSingle();
  if (row) {
    await supabase
      .from('budgets')
      .update({ sales_budget: total, updated_by: ctx.userId })
      .eq('id', row.id);
  } else if (total > 0) {
    await supabase.from('budgets').insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      month: monthKey,
      sales_budget: total,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
  }

  revalidatePath('/app/budgets');
  revalidatePath('/app/budgets/daily');
  return { total };
}
