import 'server-only';
import { can } from '@/lib/permissions';
import type { SessionContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadCostingImpact, loadCostingItems, loadCostingWaste, loadRecipeDetail } from '@/lib/costing-server';
import { parseNativeCostingAction, parseNativeCostingQuery } from '@/lib/native-costing';
import { addRecipeLine, deleteRecipeLine, updateRecipeLine } from '@/app/app/costing/actions';
import {
  COST_RATE_DANGER_THRESHOLD,
  COST_RATE_WARNING_THRESHOLD,
  ITEM_TYPE_LABELS,
  PRICE_DEVIATION_THRESHOLD,
  WASTE_DEFAULT_DAYS,
  costRateTone,
  type CostableItemType,
} from '@/components/costing/labels';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 原価管理の iPad ネイティブ（Web の /app/costing・/app/costing/[menuItemId] と同じ中身・操作）。
 *   GET part=costing        … [商品原価] 上の3つの数字・カテゴリ・商品の一覧（?category= ?q=）
 *   GET part=costingImpact  … [仕入影響] 乖離している食材・食材の選択肢・選んだ食材の影響（?ingredient=）
 *   GET part=costingWaste   … [廃棄・在庫差異] 期間の廃棄・直近の棚卸の差異（?from= ?to=）
 *   GET part=costingItem    … [レシピ編集] 売価・原価・原価率・粗利・レシピ明細・食材の選択肢（?id=）
 *   POST costingLineAdd / costingLineUpdate / costingLineDelete … レシピの食材の追加・編集・削除（app/app/costing/actions.ts）
 * 読み込みは lib/costing-server.ts（Web と共用）。権限は Web と同じ：機能「レシピ・原価管理」が有効 ＋ menu.manage。
 * CSV 出力は iPad が Web の /app/costing/export（csv.export）をそのまま取りに行く。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

/** Web の requireFeature('costing') ＋ requirePermission('menu.manage') と同じ */
function deny(ctx: SessionContext): NativeModuleResult | null {
  if (ctx.disabledFeatures?.has('costing')) return { status: 403, body: { ok: false, error: 'レシピ・原価管理は使えません（機能が無効です）' } };
  if (!can(ctx.role, 'menu.manage')) return { status: 403, body: { ok: false, error: '原価管理の権限がありません' } };
  return null;
}

const itemTypeLabel = (t: string) => ITEM_TYPE_LABELS[t as CostableItemType] ?? t;

/** [商品原価] */
export const costingGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const denied = deny(ctx);
  if (denied) return denied;
  const query = parseNativeCostingQuery(url.searchParams);
  const data = await loadCostingItems(await createClient(), ctx.organizationId!, store.id, { category: query.category, q: query.q });
  return {
    body: {
      ok: true,
      store,
      category: query.category,
      q: query.q,
      canExport: can(ctx.role, 'csv.export'),
      warningThreshold: COST_RATE_WARNING_THRESHOLD,
      dangerThreshold: COST_RATE_DANGER_THRESHOLD,
      summary: data.summary,
      categories: data.categories,
      rows: data.rows.map((r) => ({ ...r, itemTypeLabel: itemTypeLabel(r.itemType), rateTone: costRateTone(r.costRate) })),
    },
  };
};

/** [仕入影響] */
export const costingImpactGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const denied = deny(ctx);
  if (denied) return denied;
  const query = parseNativeCostingQuery(url.searchParams);
  const data = await loadCostingImpact(await createClient(), ctx.organizationId!, store.id, query.ingredient);
  return {
    body: {
      ok: true,
      store,
      threshold: PRICE_DEVIATION_THRESHOLD,
      ingredients: data.ingredients,
      deviations: data.deviations,
      selected: data.selected,
      impactRows: data.impactRows,
    },
  };
};

/** [廃棄・在庫差異] */
export const costingWasteGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const denied = deny(ctx);
  if (denied) return denied;
  const query = parseNativeCostingQuery(url.searchParams);
  const data = await loadCostingWaste(await createClient(), ctx.organizationId!, store.id, query.from, query.to);
  return {
    body: {
      ok: true,
      store,
      defaultDays: WASTE_DEFAULT_DAYS,
      today: data.today,
      from: data.rangeFrom,
      to: data.rangeTo,
      periods: data.periods,
      totalWasteAmount: data.totalWasteAmount,
      wasteRows: data.wasteRows,
      latestCountDate: data.latestCount?.countDate ?? null,
      diffRows: data.diffRows,
    },
  };
};

/** [レシピ編集] */
export const costingItemGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const denied = deny(ctx);
  if (denied) return denied;
  const query = parseNativeCostingQuery(url.searchParams);
  if (!query.id) return { status: 404, body: { ok: false, error: '商品が見つかりません' } };
  const d = await loadRecipeDetail(await createClient(), ctx.organizationId!, store.id, query.id);
  if (!d) return { status: 404, body: { ok: false, error: '商品が見つかりません' } };
  return {
    body: {
      ok: true,
      store,
      item: {
        id: d.menuItem.id,
        name: d.menuItem.name,
        itemType: d.menuItem.item_type,
        itemTypeLabel: itemTypeLabel(d.menuItem.item_type),
        price: d.menuItem.price,
        manualCost: d.menuItem.cost,
      },
      recipeCost: d.recipeCost,
      displayCost: d.displayCost,
      costRate: d.rate,
      rateTone: costRateTone(d.rate),
      grossProfit: d.gp.profit,
      grossProfitRate: d.gp.rate,
      missingCostCount: d.missingCostCount,
      lines: d.lineRows,
      ingredientOptions: d.ingredientOptions,
    },
  };
};

/** レシピの食材の追加・編集・削除（Web の RecipeLineForm・RecipeTable と同じ Server Action） */
export const costingLinePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = deny(ctx);
  if (denied) return denied;
  const parsed = parseNativeCostingAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const a = parsed.action;

  // 商品・食材が自分の企業のものか（Web は画面の選択肢からしか選べない。アプリからの値はここで確かめる）
  const supabase = await createClient();
  const { data: menuItem } = await supabase
    .from('menu_items')
    .select('id')
    .eq('id', a.menuItemId)
    .eq('organization_id', ctx.organizationId!)
    .maybeSingle();
  if (!menuItem) return { status: 404, body: { ok: false, error: '商品が見つかりません' } };
  if (a.type !== 'costingLineDelete') {
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', a.inventoryItemId)
      .eq('organization_id', ctx.organizationId!)
      .maybeSingle();
    if (!inv) return { status: 404, body: { ok: false, error: '食材が見つかりません' } };
  }

  let result: { error?: string };
  switch (a.type) {
    case 'costingLineAdd':
      result = await addRecipeLine({ menuItemId: a.menuItemId, inventoryItemId: a.inventoryItemId, quantity: a.quantity, note: a.note });
      break;
    case 'costingLineUpdate':
      result = await updateRecipeLine(a.lineId, { menuItemId: a.menuItemId, inventoryItemId: a.inventoryItemId, quantity: a.quantity, note: a.note });
      break;
    case 'costingLineDelete':
      result = await deleteRecipeLine(a.lineId, a.menuItemId);
      break;
  }
  if (result.error) return { status: 400, body: { ok: false, error: result.error } };
  return { body: { ok: true } };
};
