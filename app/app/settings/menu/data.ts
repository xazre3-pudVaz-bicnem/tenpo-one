import 'server-only';
import { isCustomPriceHelper } from '@/lib/custom-price';
import { createClient } from '@/lib/supabase/server';
import { courseStepsFrom, type CourseSteps } from '@/lib/course-steps';
import { isMissingColumnError } from '@/lib/schema-compat';
import type { MenuItemRow } from '@/components/settings/menu-item-dialog';
import type { CategoryRow } from '@/components/settings/category-panel';

interface MenuCtx {
  organizationId: string;
}

export interface MenuSettingsData {
  categoryRows: CategoryRow[];
  /**
   * カテゴリの厨房ステーション（カテゴリ画面の振り分け用）と「注文時に会計伝票を印刷」。
   * printBillOnOrder は DB に列が無い（migration 00101 未適用）とき null
   */
  stations: { id: string; name: string; station: string; printBillOnOrder: boolean | null }[];
  itemRows: MenuItemRow[];
  taxRates: { id: string; name: string }[];
}

/**
 * 設定 > メニュー / プラン / カテゴリ で共通に使う、店舗のカテゴリ・商品・税率。
 * （2026-09-23 dinii と同じく「メニュー・プラン・オプション・カテゴリ」を別の画面に分けた）
 */
export async function loadMenuSettingsData(ctx: MenuCtx, storeId: string): Promise<MenuSettingsData> {
  const supabase = await createClient();

  const [{ data: categories }, { data: items }, { data: taxRates }, billRes] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, name_en, color, sort_order, station')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select(
        `id, category_id, name, name_en, name_kana, description, item_type, price, takeout_price, cost, tax_rate_id,
         duration_minutes, sell_start_time, sell_end_time, sort_order, is_sold_out, status, price_pending`
      )
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('sort_order'),
    supabase
      .from('tax_rates')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false }),
    // 「注文時に会計伝票を印刷」は別に読む（列がまだ無い DB でもカテゴリ画面を止めない）
    supabase
      .from('menu_categories')
      .select('id, print_bill_on_order')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`),
  ]);
  const billColumnMissing = !!billRes.error && isMissingColumnError(billRes.error.message, 'print_bill_on_order');
  const billOn = new Map(((billRes.data ?? []) as { id: string; print_bill_on_order: boolean }[]).map((r) => [r.id, r.print_bill_on_order === true]));

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.name_en ?? '',
    color: c.color ?? '#bc5940',
    sortOrder: c.sort_order,
  }));

  // 「その他（価格入力）」ボタン用の非表示の商品（lib/custom-price）は一覧に出さない（消す・表示に戻すと困るため）
  const itemRows: MenuItemRow[] = (items ?? []).filter((i) => !isCustomPriceHelper(i)).map((i) => ({
    id: i.id,
    categoryId: i.category_id,
    name: i.name,
    nameEn: i.name_en ?? '',
    nameKana: i.name_kana ?? '',
    description: i.description ?? '',
    itemType: i.item_type,
    price: i.price,
    takeoutPrice: i.takeout_price,
    cost: i.cost,
    taxRateId: i.tax_rate_id,
    durationMinutes: i.duration_minutes,
    sellStartTime: i.sell_start_time?.slice(0, 5) ?? null,
    sellEndTime: i.sell_end_time?.slice(0, 5) ?? null,
    sortOrder: i.sort_order,
    isSoldOut: i.is_sold_out,
    status: i.status as 'active' | 'hidden' | 'deleted',
    pricePending: i.price_pending ?? false,
  }));

  return {
    categoryRows,
    stations: (categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      station: c.station,
      printBillOnOrder: billColumnMissing ? null : (billOn.get(c.id) ?? false),
    })),
    itemRows,
    taxRates: (taxRates ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

/** 設定 > プラン で出す「コースの料理（出す順）」（店舗設定 store_settings.settings.courseSteps） */
export async function loadCourseSteps(storeId: string): Promise<CourseSteps> {
  const supabase = await createClient();
  const { data } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  return courseStepsFrom(data?.settings ?? null);
}
