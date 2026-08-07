'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PATH = '/app/budgets';

export interface BudgetInput {
  storeId: string | null; // null = 全社
  month: string; // 'YYYY-MM-01'
  salesBudget: number;
  costRateTarget: number | null;
  laborRateTarget: number | null;
  profitTarget: number | null;
  guestsTarget: number | null;
  avgSpendTarget: number | null;
  note: string | null;
}

/** 予算を登録・更新する（月×店舗の一意制約でupsert）。全社行は本社(org_owner/hq_admin)のみ */
export async function upsertBudget(input: BudgetInput) {
  const ctx = await requirePermission('store.settings');

  if (input.storeId === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') {
      throw new Error('全社予算の編集は本社管理者のみ行えます');
    }
  } else if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('担当外の店舗です');
  }

  if (!Number.isFinite(input.salesBudget) || input.salesBudget < 0) {
    throw new Error('売上予算を正しく入力してください');
  }

  const supabase = await createClient();

  // budgets の一意制約は coalesce(store_id, ダミーuuid) を使った式インデックスのため、
  // supabase-js の upsert(onConflict) では対象にできない。select→insert/updateで代替する。
  let existingQuery = supabase.from('budgets').select('id').eq('organization_id', ctx.organizationId).eq('month', input.month);
  existingQuery = input.storeId === null ? existingQuery.is('store_id', null) : existingQuery.eq('store_id', input.storeId);
  const { data: existing } = await existingQuery.maybeSingle();

  const payload = {
    cost_rate_target: input.costRateTarget,
    labor_rate_target: input.laborRateTarget,
    profit_target: input.profitTarget != null ? Math.round(input.profitTarget) : null,
    guests_target: input.guestsTarget,
    avg_spend_target: input.avgSpendTarget != null ? Math.round(input.avgSpendTarget) : null,
    note: input.note,
    sales_budget: Math.round(input.salesBudget),
    updated_by: ctx.userId,
  };

  const { error } = existing
    ? await supabase.from('budgets').update(payload).eq('id', existing.id)
    : await supabase.from('budgets').insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        month: input.month,
        created_by: ctx.userId,
        ...payload,
      });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
  revalidatePath('/app/reports');
}
