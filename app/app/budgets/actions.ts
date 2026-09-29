'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { addDaysStr } from '@/components/reports/period';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import { distributeByWeekday, weekdayWeights, WEEKDAY_WEIGHT_DAYS } from '@/lib/daily-budget';

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

/**
 * 月の売上目標（budgets.sales_budget）だけを保存する（予算管理の「今月の売上目標」。2026-09-30 Ronnie）。
 * ほかの目標（原価率・人件費率…）はそのまま。全社は本社(org_owner/hq_admin)のみ
 */
export async function saveMonthlySalesTarget(input: {
  storeId: string | null;
  month: string;
  amount: number;
}): Promise<{ error?: string; dailyDistributed?: boolean }> {
  const ctx = await requirePermission('store.settings');
  if (input.storeId === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') return { error: '全社の目標は本社管理者のみ変更できます' };
  } else if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '担当外の店舗です' };
  }
  if (!/^\d{4}-\d{2}-01$/.test(input.month)) return { error: '対象月が正しくありません' };
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000_000) {
    return { error: '売上目標を正しく入力してください' };
  }

  const supabase = await createClient();
  let existingQuery = supabase.from('budgets').select('id').eq('organization_id', ctx.organizationId).eq('month', input.month);
  existingQuery = input.storeId === null ? existingQuery.is('store_id', null) : existingQuery.eq('store_id', input.storeId);
  const { data: existing } = await existingQuery.maybeSingle();

  const { error } = existing
    ? await supabase.from('budgets').update({ sales_budget: amount, updated_by: ctx.userId }).eq('id', existing.id)
    : await supabase.from('budgets').insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        month: input.month,
        sales_budget: amount,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      });
  if (error) return { error: `保存できませんでした: ${error.message}` };

  // 店舗の目標は、曜日ごとの売上（直近8週）に合わせて日別予算にも分ける（ホームの本日の予算になる）
  let dailyDistributed = false;
  if (input.storeId) {
    try {
      dailyDistributed = await autoDailyBudgets(supabase, ctx.organizationId, ctx.userId, input.storeId, input.month, amount);
    } catch (e) {
      console.error('[budgets] daily distribution failed', e instanceof Error ? e.message : e);
    }
  }

  revalidatePath(PATH);
  revalidatePath('/app/budgets/daily');
  revalidatePath('/app/reports');
  revalidatePath('/app');
  revalidatePath('/app/dashboard');
  return { dailyDistributed };
}

/**
 * 月の目標を日別予算（store_settings.settings.dailyBudgets[YYYY-MM]）に分けて入れる。
 * 重みは直近8週（昨日まで）の曜日ごとの1日あたり売上（会計済みの伝票の合計）。記録が無ければ毎日同じ。
 * 2026-09-30 Ronnie「金曜 100万・月曜 40万のように。前の月・前の週をもとに日報の目標を自動で」
 */
async function autoDailyBudgets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  userId: string,
  storeId: string,
  monthFirst: string,
  amount: number
): Promise<boolean> {
  const month = monthFirst.slice(0, 7);
  const to = addDaysStr(todayJst(), -1);
  const from = addDaysStr(todayJst(), -WEEKDAY_WEIGHT_DAYS);
  const salesByDate = new Map<string, number>();
  // 1回の取得は1000行まで。ページを分けて読む
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('business_date, total')
      .eq('store_id', storeId)
      .in('status', SETTLED_ORDER_STATUSES)
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date')
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const o of data ?? []) {
      salesByDate.set(o.business_date, (salesByDate.get(o.business_date) ?? 0) + Number(o.total ?? 0));
    }
    if ((data ?? []).length < 1000) break;
  }
  const weights = weekdayWeights([...salesByDate].map(([date, sales]) => ({ date, sales })));
  const daily = amount > 0 ? distributeByWeekday(amount, month, weights) : {};

  const { data: existing } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const allMonths = ((current.dailyBudgets as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: organizationId,
      store_id: storeId,
      settings: { ...current, dailyBudgets: { ...allMonths, [month]: daily } },
      updated_by: userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) throw new Error(error.message);
  return true;
}
