import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { buildPlanItems, type HandyPlanItem, type PlanItemInput } from '@/lib/handy-visit';

/**
 * お客様情報（来店登録）の画面で選ぶプラン商品（コース・飲み放題など）。
 * ハンディ（/handy/[tableId]/setup）とレジのファーストオーダー（/app/floor/[tableId]/setup）で共通。
 */
export async function loadSetupPlanItems(organizationId: string, storeId: string): Promise<HandyPlanItem[]> {
  const supabase = await createClient();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name')
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('status', 'active'),
    supabase
      .from('menu_items')
      .select(
        'id, category_id, name, price, item_type, is_sold_out, duration_minutes, course_includes_drinks, course_includes_ayce'
      )
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('status', 'active')
      .neq('item_type', 'option')
      .order('sort_order'),
  ]);
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const planInputs: PlanItemInput[] = (items ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    categoryName: m.category_id ? (categoryNameById.get(m.category_id) ?? null) : null,
    price: m.price,
    itemType: m.item_type,
    isSoldOut: m.is_sold_out,
    durationMinutes: m.duration_minutes,
    courseIncludesDrinks: m.course_includes_drinks,
    courseIncludesAyce: m.course_includes_ayce,
  }));
  return buildPlanItems(planInputs);
}
