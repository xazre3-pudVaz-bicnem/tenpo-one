import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingSignals } from '@/lib/tenant-onboarding';

/**
 * 店舗の導入チェックリスト「自動判定(auto)」項目を、DB状態から算出する。
 * CYPRESS運営の admin client（service role）で呼び出す想定。
 * ここでは推測で埋めない — 実データが存在するかどうかだけを見る。
 */
export async function computeStoreSignals(
  admin: SupabaseClient,
  store: { id: string; organization_id: string; slug: string | null; seat_count: number | null; booking_enabled: boolean }
): Promise<OnboardingSignals> {
  const orgId = store.organization_id;
  const storeId = store.id;
  const countHead = (q: { count: number | null }) => (q.count ?? 0) > 0;

  const [
    owner,
    hours,
    settings,
    tables,
    tableQr,
    menu,
    categories,
    course,
    tax,
    register,
    hwTerminal,
    hwPrinter,
    hwKds,
    staff,
    inventory,
  ] = await Promise.all([
    admin.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('role', 'org_owner').eq('status', 'active'),
    admin.from('business_hours').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_closed', false).not('open_time', 'is', null),
    admin.from('store_settings').select('cancellation_policy').eq('store_id', storeId).maybeSingle(),
    admin.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
    admin.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active').not('qr_token', 'is', null),
    admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('item_type', ['food', 'drink']).eq('status', 'active'),
    admin.from('menu_categories').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
    admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('item_type', 'course').eq('status', 'active'),
    admin.from('tax_rates').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    admin.from('registers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
    admin.from('store_hardware').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('category', 'payment_terminal').neq('status', 'removed'),
    admin.from('store_hardware').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('category', 'printer').neq('status', 'removed'),
    admin.from('store_hardware').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('category', 'kds').neq('status', 'removed'),
    admin.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
    admin.from('inventory_items').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
  ]);

  return {
    org_created: true,
    store_created: true,
    slug_set: !!store.slug,
    owner_account: countHead(owner),
    business_hours: countHead(hours),
    reservation_enabled: store.booking_enabled,
    cancel_policy: !!(settings.data?.cancellation_policy),
    public_url: store.booking_enabled && !!store.slug,
    tables: countHead(tables),
    seat_count: (store.seat_count ?? 0) > 0,
    table_qr: countHead(tableQr),
    menu_items: countHead(menu),
    categories: countHead(categories),
    course: countHead(course),
    tax: countHead(tax),
    register: countHead(register),
    hw_payment_terminal: countHead(hwTerminal),
    hw_printer: countHead(hwPrinter),
    hw_kds: countHead(hwKds),
    staff: (staff.count ?? 0) >= 2,
    inventory: countHead(inventory),
  };
}
