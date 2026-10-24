import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 発注書を作成（GET ?part=poNew）。Web の /app/purchases/new と同じ：取引中の仕入先と、この店の在庫品目 */
export async function loadNativePoNew(supabase: Supabase, organizationId: string, storeId: string) {
  const [{ data: vendorsData }, { data: itemsData }] = await Promise.all([
    supabase.from('vendors').select('id, name').eq('organization_id', organizationId).eq('status', 'active').order('name'),
    supabase
      .from('inventory_items')
      .select('id, name, unit, avg_cost, purchase_unit')
      .eq('organization_id', organizationId)
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('name'),
  ]);
  return {
    vendors: (vendorsData ?? []).map((v) => ({ id: v.id as string, name: v.name as string })),
    items: (itemsData ?? []).map((i) => ({
      id: i.id as string,
      name: i.name as string,
      unit: i.unit as string,
      avgCost: i.avg_cost as number | null,
      purchaseUnit: i.purchase_unit as string | null,
    })),
  };
}
