import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { ITEM_KIND_LABELS, STOCK_WARNING_LABELS, stockWarningLevel, type ItemKind } from '@/components/inventory/labels';

/** 在庫CSV出力（品目・現在庫・発注点/最低/適正在庫・平均/最終仕入単価・在庫金額・警告状態） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('store') ?? ctx.currentStore?.id ?? null;

  let query = supabase
    .from('inventory_items')
    .select(
      'name, item_kind, unit, purchase_unit, current_quantity, reorder_point, min_quantity, optimal_quantity, avg_cost, last_purchase_cost'
    )
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');
  if (storeId) query = query.eq('store_id', storeId);

  const { data } = await query.order('name');

  const rows = (data ?? []).map((i) => {
    const currentQuantity = Number(i.current_quantity);
    const warning = stockWarningLevel({
      currentQuantity,
      minQuantity: i.min_quantity != null ? Number(i.min_quantity) : null,
      reorderPoint: i.reorder_point != null ? Number(i.reorder_point) : null,
    });
    return [
      i.name,
      ITEM_KIND_LABELS[i.item_kind as ItemKind] ?? i.item_kind,
      i.unit,
      i.purchase_unit ?? '',
      currentQuantity,
      i.reorder_point,
      i.min_quantity,
      i.optimal_quantity,
      i.avg_cost,
      i.last_purchase_cost,
      i.avg_cost != null ? Math.round(currentQuantity * i.avg_cost) : '',
      warning ? STOCK_WARNING_LABELS[warning] : '',
    ];
  });

  const csv = toCsv(
    ['品目', '種別', '単位', '仕入単位', '現在庫', '発注点', '最低在庫', '適正在庫', '平均仕入単価', '最終仕入単価', '在庫金額', '警告状態'],
    rows
  );
  return csvResponse(`inventory_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
