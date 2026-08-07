import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { fetchMenuItemCostRows } from '@/components/costing/data';
import { COST_RATE_DANGER_THRESHOLD, COST_RATE_WARNING_THRESHOLD, ITEM_TYPE_LABELS, type CostableItemType } from '@/components/costing/labels';

/** 商品別原価CSV出力（商品/カテゴリ/種別/売価/レシピ原価/原価率/粗利/粗利率/食材数/警告） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('store') ?? ctx.currentStore?.id ?? ctx.stores[0]?.id ?? null;
  if (!storeId || !ctx.organizationId) {
    return csvResponse('menu_item_costs.csv', toCsv(['商品', '売価', 'レシピ原価', '原価率', '粗利', '粗利率', '食材数', '警告'], []));
  }

  const { rows } = await fetchMenuItemCostRows(supabase, ctx.organizationId, storeId, {
    categoryId: searchParams.get('category'),
    q: searchParams.get('q'),
  });

  const csvRows = rows.map((r) => {
    const warnings: string[] = [];
    if (r.ingredientCount === 0) warnings.push('レシピ未設定');
    if (r.missingCostCount > 0) warnings.push(`原価未設定食材あり（${r.missingCostCount}件）`);
    if (r.costRate != null && r.costRate > COST_RATE_DANGER_THRESHOLD) warnings.push('原価率 危険水準');
    else if (r.costRate != null && r.costRate > COST_RATE_WARNING_THRESHOLD) warnings.push('原価率 要注意');

    return [
      r.name,
      ITEM_TYPE_LABELS[r.itemType as CostableItemType] ?? r.itemType,
      r.categoryName,
      r.price,
      r.ingredientCount > 0 ? r.recipeCost : '',
      r.manualCost ?? '',
      r.costRate != null ? r.costRate : '',
      r.grossProfitYen != null ? r.grossProfitYen : '',
      r.grossProfitRate != null ? r.grossProfitRate : '',
      r.ingredientCount,
      warnings.join('、'),
    ];
  });

  const csv = toCsv(
    ['商品', '種別', 'カテゴリ', '売価', 'レシピ原価', '手入力原価', '原価率(%)', '粗利益', '粗利率(%)', '食材数', '警告'],
    csvRows
  );
  return csvResponse(`menu_item_costs_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
