import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { PO_STATUS_LABELS, type PoStatus } from '@/components/inventory/labels';

const HEADERS = [
  '発注番号',
  '状態',
  '仕入先',
  '店舗',
  '発注日',
  '入荷予定日',
  '担当者',
  '品目',
  '数量',
  '単位',
  '単価（税抜）',
  '税率',
  '金額（税抜）',
  '税額',
  '金額（税込）',
];

/** 発注CSV出力（期間・状態指定、明細レベル、税込税抜） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const storeId = searchParams.get('store') ?? ctx.currentStore?.id ?? null;

  let query = supabase
    .from('purchase_orders')
    .select('id, po_no, status, expected_at, ordered_at, created_at, requested_by, vendors(name), stores(name)')
    .eq('organization_id', ctx.organizationId);
  if (storeId) query = query.eq('store_id', storeId);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('created_at', `${from}T00:00:00+09:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59+09:00`);
  const { data: poList } = await query.order('created_at', { ascending: false }).limit(1000);
  const orders = poList ?? [];

  if (orders.length === 0) {
    return csvResponse(`purchases_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(HEADERS, []));
  }

  const poIds = orders.map((p) => p.id);
  const { data: itemsData } = await supabase
    .from('purchase_order_items')
    .select('purchase_order_id, name, quantity, unit, unit_cost, tax_rate')
    .in('purchase_order_id', poIds)
    .order('created_at');

  const itemsByPo = new Map<string, { name: string; quantity: number; unit: string; unit_cost: number; tax_rate: number }[]>();
  for (const it of itemsData ?? []) {
    const list = itemsByPo.get(it.purchase_order_id as string) ?? [];
    list.push({
      name: it.name as string,
      quantity: Number(it.quantity),
      unit: it.unit as string,
      unit_cost: it.unit_cost as number,
      tax_rate: Number(it.tax_rate),
    });
    itemsByPo.set(it.purchase_order_id as string, list);
  }

  const requesterIds = [...new Set(orders.map((p) => p.requested_by).filter((v): v is string => !!v))];
  let requesterNames = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', requesterIds);
    requesterNames = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  }

  const rows: (string | number)[][] = [];
  for (const po of orders) {
    const vendorName = (po.vendors as unknown as { name: string } | null)?.name ?? '';
    const storeName = (po.stores as unknown as { name: string } | null)?.name ?? '';
    const requester = po.requested_by ? (requesterNames.get(po.requested_by) ?? '') : '';
    const statusLabel = PO_STATUS_LABELS[po.status as PoStatus] ?? po.status;
    const orderDate = (po.created_at as string | null)?.slice(0, 10) ?? '';
    const items = itemsByPo.get(po.id as string) ?? [];
    for (const it of items) {
      const amountExcl = Math.round(it.quantity * it.unit_cost);
      const tax = Math.round((amountExcl * it.tax_rate) / 100);
      rows.push([
        po.po_no as number,
        statusLabel,
        vendorName,
        storeName,
        orderDate,
        po.expected_at ?? '',
        requester,
        it.name,
        it.quantity,
        it.unit,
        it.unit_cost,
        `${it.tax_rate}%`,
        amountExcl,
        tax,
        amountExcl + tax,
      ]);
    }
  }

  const csv = toCsv(HEADERS, rows);
  return csvResponse(`purchases_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
