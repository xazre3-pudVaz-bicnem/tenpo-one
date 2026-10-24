import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { STOCK_UNITS } from '@/lib/units';
import { stockWarningLevel, type CountStatus } from '@/components/inventory/labels';
import {
  loadInventoryItems,
  loadInventoryCounts,
  loadInventoryTransfers,
  loadInventoryReorder,
  loadInventoryForecast,
} from '@/lib/inventory-data-server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const NATIVE_INVENTORY_TABS = ['items', 'counts', 'transfers', 'reorder', 'forecast'] as const;
export type NativeInventoryTab = (typeof NATIVE_INVENTORY_TABS)[number];

/** 在庫（GET ?part=inventory&tab=…）。Web の /app/inventory と同じ読み込み（lib/inventory-data-server.ts を共用） */
export async function loadNativeInventory(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string },
  q: { tab: NativeInventoryTab; kind: string; q: string; sort: string; item: string }
) {
  // 企業が無いことはない（ログイン済み）が、無ければ何も出さない
  const org = ctx.organizationId ?? '';
  const base = {
    store,
    tab: q.tab,
    canWrite: can(ctx.role, 'inventory.write'),
    canTransfer: can(ctx.role, 'vendors.manage'),
    otherStores: ctx.stores.filter((s) => s.id !== store.id).map((s) => ({ id: s.id, name: s.name })),
    units: [...STOCK_UNITS],
  };
  if (q.tab === 'items') {
    const { rows, priceIncreaseItemIds } = await loadInventoryItems(supabase, org, store.id, {
      kind: q.kind || undefined,
      q: q.q || undefined,
      sortWarning: q.sort === 'warning',
    });
    // 上の4つの数字と要発注リストは Web の画面と同じ計算
    const totalStockValue = rows.reduce((sum, r) => sum + Math.round(r.currentQuantity * (r.avgCost ?? 0)), 0);
    const reorderAll = rows.filter((r) => r.reorderPoint != null && r.currentQuantity <= r.reorderPoint);
    const dangerCount = rows.filter((r) => r.minQuantity != null && r.currentQuantity <= r.minQuantity).length;
    return {
      ...base,
      items: rows.map((r) => ({
        ...r,
        warning: stockWarningLevel(r),
        priceUp: priceIncreaseItemIds.has(r.id),
        stockValue: Math.round(r.currentQuantity * (r.avgCost ?? 0)),
      })),
      stats: { totalStockValue, reorderCount: reorderAll.length, dangerCount, priceUpCount: priceIncreaseItemIds.size },
      reorderList: [...reorderAll].sort((a, b) => a.currentQuantity - b.currentQuantity).slice(0, 8).map((r) => r.id),
    };
  }
  if (q.tab === 'counts') return { ...base, counts: await loadInventoryCounts(supabase, org, store.id) };
  if (q.tab === 'transfers') {
    const t = await loadInventoryTransfers(supabase, org, store.id);
    return { ...base, transfers: t.rows, transferItems: t.itemOptions };
  }
  if (q.tab === 'reorder') return { ...base, reorder: await loadInventoryReorder(supabase, org, store.id) };
  return { ...base, forecast: await loadInventoryForecast(supabase, org, store.id, q.item || undefined) };
}

/** 棚卸の中身（GET ?part=inventoryCount&id）。Web の /app/inventory/counts/[id] と同じ */
export async function loadNativeInventoryCount(ctx: SessionContext, supabase: Supabase, id: string) {
  const { data: count } = await supabase
    .from('stock_counts')
    .select('*, stores(name)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!count) return null;
  const { data: itemsData } = await supabase
    .from('stock_count_items')
    .select('*, inventory_items(name, unit)')
    .eq('stock_count_id', id);
  const items = (itemsData ?? [])
    .map((i) => {
      const inv = i.inventory_items as unknown as { name: string; unit: string } | null;
      return {
        id: i.id as string,
        name: inv?.name ?? '不明な品目',
        unit: inv?.unit ?? '',
        expectedQuantity: Number(i.expected_quantity),
        countedQuantity: i.counted_quantity != null ? Number(i.counted_quantity) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return {
    id: count.id as string,
    countDate: count.count_date as string,
    status: count.status as CountStatus,
    storeName: (count.stores as unknown as { name: string } | null)?.name ?? '',
    canWrite: can(ctx.role, 'inventory.write'),
    items,
  };
}
