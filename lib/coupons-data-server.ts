import type { createClient } from '@/lib/supabase/server';
import type { CouponRow } from '@/app/app/coupons/coupons-panel';

/**
 * クーポン管理（/app/coupons）の読み込み。Web の画面と iPad アプリのネイティブ画面（GET ?part=coupons）で同じものを使う。
 * 中身は app/app/coupons/page.tsx にあったものをそのまま移した（2026-10-24）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface CouponQueryRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  value: number;
  store_id: string | null;
  stores: { name: string } | null;
  target_category_id: string | null;
  menu_categories: { name: string } | null;
  target_menu_item_id: string | null;
  menu_items: { name: string } | null;
  min_total: number;
  starts_at: string | null;
  ends_at: string | null;
  time_from: string | null;
  time_to: string | null;
  max_uses: number | null;
  per_customer_limit: number | null;
  first_visit_only: boolean;
  stackable: boolean;
  status: string;
  coupon_redemptions: { count: number }[] | null;
}

export async function loadCouponsData(supabase: Supabase, organizationId: string) {
  const [{ data: couponRows }, { data: storeRows }, { data: categoryRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from('coupons')
      .select(
        `id, code, name, kind, value, store_id, stores(name),
         target_category_id, menu_categories(name), target_menu_item_id, menu_items(name),
         min_total, starts_at, ends_at, time_from, time_to, max_uses, per_customer_limit,
         first_visit_only, stackable, status, coupon_redemptions(count)`
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
    supabase.from('stores').select('id, name').eq('organization_id', organizationId).eq('status', 'active').order('name'),
    supabase.from('menu_categories').select('id, name').eq('organization_id', organizationId).eq('status', 'active').order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('organization_id', organizationId)
      .neq('status', 'deleted')
      .order('sort_order'),
  ]);

  const rows: CouponRow[] = ((couponRows ?? []) as unknown as CouponQueryRow[]).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    kind: c.kind as 'fixed' | 'percent',
    value: c.value,
    storeId: c.store_id,
    storeName: c.stores?.name ?? null,
    targetCategoryId: c.target_category_id,
    targetMenuItemId: c.target_menu_item_id,
    targetLabel: c.menu_categories?.name ?? c.menu_items?.name ?? '全体',
    minTotal: c.min_total,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    timeFrom: c.time_from,
    timeTo: c.time_to,
    maxUses: c.max_uses,
    perCustomerLimit: c.per_customer_limit,
    firstVisitOnly: c.first_visit_only,
    stackable: c.stackable,
    status: c.status as CouponRow['status'],
    redemptionCount: c.coupon_redemptions?.[0]?.count ?? 0,
  }));

  return {
    rows,
    stores: (storeRows ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
    categories: (categoryRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string })),
    items: (itemRows ?? []).map((i) => ({ id: i.id as string, name: i.name as string })),
  };
}
