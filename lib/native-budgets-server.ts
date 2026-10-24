import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { loadBudgetsData, SEAT_ONLY_UNIT_DAYS } from '@/lib/budgets-data-server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 予算管理（GET ?part=budgets&month=YYYY-MM）。Web の /app/budgets と同じ計算（lib/budgets-data-server.ts を共用） */
export async function loadNativeBudgets(ctx: SessionContext, supabase: Supabase, month: string | undefined) {
  const d = await loadBudgetsData(ctx, supabase, month);
  if (!d) return null;
  const budgetOf = (b: (typeof d.rows)[number]['budget']) =>
    b
      ? {
          salesBudget: Number(b.sales_budget ?? 0),
          costRateTarget: b.cost_rate_target != null ? Number(b.cost_rate_target) : null,
          laborRateTarget: b.labor_rate_target != null ? Number(b.labor_rate_target) : null,
          profitTarget: b.profit_target != null ? Number(b.profit_target) : null,
          guestsTarget: b.guests_target != null ? Number(b.guests_target) : null,
          avgSpendTarget: b.avg_spend_target != null ? Number(b.avg_spend_target) : null,
          note: (b.note as string | null) ?? null,
        }
      : null;
  return {
    month: d.monthFirst.slice(0, 7),
    monthFirst: d.monthFirst,
    monthLast: d.monthLast,
    elapsedDays: d.elapsedDays,
    daysInMonth: d.daysInMonth,
    canEdit: d.canEdit,
    includeTakeoutGuests: d.metricsOpts.includeTakeoutGuests !== false,
    rows: d.rows.map((r) => ({
      storeId: r.storeId,
      storeName: r.storeName,
      editable: d.rowEditable(r.storeId),
      budget: budgetOf(r.budget),
      actual: r.actual,
      achievementPct: r.achievementPct,
      forecast: r.forecast,
      forecastPct: r.forecastPct,
    })),
    target: {
      storeId: d.targetRow.storeId,
      storeName: d.targetRow.storeName,
      editable: d.targetEditable,
      amount: d.targetAmount != null ? Number(d.targetAmount) : null,
      sales: d.targetRow.actual.sales,
      achievementPct: d.targetRow.achievementPct,
    },
    monthLabel: d.monthLabel,
    forecastFrom: d.forecastFrom,
    booking: d.forecast,
    singleUnit: d.singleUnit,
    landing: d.landing,
    seatOnlyUnitDays: SEAT_ONLY_UNIT_DAYS,
  };
}
