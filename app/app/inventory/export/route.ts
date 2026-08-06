import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { ITEM_KIND_LABELS, type ItemKind } from '@/components/inventory/labels';

/** 在庫CSV出力（品目・現在庫・発注点・在庫金額） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('store') ?? ctx.currentStore?.id ?? null;

  let query = supabase
    .from('inventory_items')
    .select('name, item_kind, unit, current_quantity, reorder_point, avg_cost')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');
  if (storeId) query = query.eq('store_id', storeId);

  const { data } = await query.order('name');

  const rows = (data ?? []).map((i) => [
    i.name,
    ITEM_KIND_LABELS[i.item_kind as ItemKind] ?? i.item_kind,
    i.unit,
    i.current_quantity,
    i.reorder_point,
    i.avg_cost != null ? Math.round(Number(i.current_quantity) * i.avg_cost) : '',
  ]);

  const csv = toCsv(['品目', '種別', '単位', '現在庫', '発注点', '在庫金額'], rows);
  return csvResponse(`inventory_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
