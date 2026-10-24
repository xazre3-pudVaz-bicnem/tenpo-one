import type { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import type { PoStatus } from '@/components/inventory/labels';

/**
 * 仕入先（/app/vendors）・発注（/app/purchases）の読み込み。Web の画面と iPad アプリのネイティブ画面で同じものを使う。
 * 中身は各ページにあったものをそのまま移した（2026-10-24）。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface VendorListRow {
  id: string;
  name: string;
  nameKana: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  closingDay: number | null;
  paymentDay: number | null;
  bankInfo: string | null;
  note: string | null;
  status: 'active' | 'inactive' | 'deleted';
  monthlyInvoiceTotal: number;
  monthlyPurchaseTotal: number;
  activePoCount: number;
}

/** 仕入先の一覧と、当月請求額・今月仕入額・進行中発注数 */
export async function loadVendorRows(
  supabase: Supabase,
  organizationId: string,
  q: { q?: string; status?: string }
): Promise<VendorListRow[]> {
  let query = supabase.from('vendors').select('*').eq('organization_id', organizationId);
  query = q.status ? query.eq('status', q.status) : query.neq('status', 'deleted');
  if (q.q) query = query.ilike('name', `%${q.q}%`);
  const { data: vendorsData } = await query.order('name');
  const vendors = vendorsData ?? [];

  // 当月請求額合計・今月仕入額（入荷済み発注の合計）・進行中発注数を集計
  const vendorIds = vendors.map((v) => v.id);
  const invoiceTotals = new Map<string, number>();
  const purchaseTotals = new Map<string, number>();
  const activePoCounts = new Map<string, number>();

  if (vendorIds.length > 0) {
    const today = todayJst();
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const ymStart = `${today.slice(0, 7)}-01`;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const ymEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const { data: invData } = await supabase
      .from('invoices')
      .select('vendor_id, amount')
      .eq('organization_id', organizationId)
      .in('vendor_id', vendorIds)
      .gte('issue_date', ymStart)
      .lt('issue_date', ymEnd);
    for (const r of invData ?? []) {
      if (r.vendor_id) invoiceTotals.set(r.vendor_id, (invoiceTotals.get(r.vendor_id) ?? 0) + r.amount);
    }

    // 「今月仕入額」= 入荷済み(received)発注のうち、当月中に受入処理された（updated_atが当月）ものの合計
    const { data: receivedPoData } = await supabase
      .from('purchase_orders')
      .select('vendor_id, total')
      .eq('organization_id', organizationId)
      .in('vendor_id', vendorIds)
      .eq('status', 'received')
      .gte('updated_at', `${ymStart}T00:00:00+09:00`)
      .lt('updated_at', `${ymEnd}T00:00:00+09:00`);
    for (const r of receivedPoData ?? []) {
      if (r.vendor_id) purchaseTotals.set(r.vendor_id, (purchaseTotals.get(r.vendor_id) ?? 0) + r.total);
    }

    const { data: poData } = await supabase
      .from('purchase_orders')
      .select('vendor_id, status')
      .eq('organization_id', organizationId)
      .in('vendor_id', vendorIds)
      .not('status', 'in', '(received,cancelled)');
    for (const r of poData ?? []) {
      activePoCounts.set(r.vendor_id, (activePoCounts.get(r.vendor_id) ?? 0) + 1);
    }
  }

  return vendors.map((v) => ({
    id: v.id,
    name: v.name,
    nameKana: v.name_kana,
    contactName: v.contact_name,
    phone: v.phone,
    email: v.email,
    address: v.address,
    closingDay: v.closing_day,
    paymentDay: v.payment_day,
    bankInfo: v.bank_info,
    note: v.note,
    status: v.status,
    monthlyInvoiceTotal: invoiceTotals.get(v.id) ?? 0,
    monthlyPurchaseTotal: purchaseTotals.get(v.id) ?? 0,
    activePoCount: activePoCounts.get(v.id) ?? 0,
  }));
}

export interface PurchaseOrderListRow {
  id: string;
  poNo: number;
  status: PoStatus;
  total: number;
  expectedAt: string | null;
  vendorName: string | null;
  storeName: string | null;
  requesterName: string | null;
  createdAt: string;
}

/** 発注の一覧（最新300件）と絞り込み用の仕入先 */
export async function loadPurchaseOrderRows(
  supabase: Supabase,
  organizationId: string,
  storeIds: string[],
  q: { status?: string; vendor?: string; from?: string; to?: string }
): Promise<{ rows: PurchaseOrderListRow[]; vendors: { id: string; name: string }[] }> {
  const { data: vendorsData } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('organization_id', organizationId)
    .neq('status', 'deleted')
    .order('name');

  let query = supabase
    .from('purchase_orders')
    .select('id, po_no, status, total, expected_at, requested_by, created_at, vendors(name), stores(name)')
    .eq('organization_id', organizationId)
    .in('store_id', storeIds.length > 0 ? storeIds : ['00000000-0000-0000-0000-000000000000']);
  if (q.status) query = query.eq('status', q.status);
  if (q.vendor) query = query.eq('vendor_id', q.vendor);
  if (q.from) query = query.gte('created_at', `${q.from}T00:00:00+09:00`);
  if (q.to) query = query.lte('created_at', `${q.to}T23:59:59+09:00`);
  const { data } = await query.order('created_at', { ascending: false }).limit(300);
  const rows = data ?? [];

  const requesterIds = [...new Set(rows.map((r) => r.requested_by).filter((v): v is string => !!v))];
  let requesterNames = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', requesterIds);
    requesterNames = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  }

  return {
    vendors: (vendorsData ?? []).map((v) => ({ id: v.id as string, name: v.name as string })),
    rows: rows.map((r) => ({
      id: r.id as string,
      poNo: Number(r.po_no),
      status: r.status as PoStatus,
      total: Number(r.total),
      expectedAt: r.expected_at as string | null,
      vendorName: (r.vendors as unknown as { name: string } | null)?.name ?? null,
      storeName: (r.stores as unknown as { name: string } | null)?.name ?? null,
      requesterName: r.requested_by ? (requesterNames.get(r.requested_by as string) ?? null) : null,
      createdAt: r.created_at as string,
    })),
  };
}

export interface PurchaseOrderDetail {
  id: string;
  poNo: number;
  status: PoStatus;
  storeId: string;
  vendorName: string;
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  total: number;
  taxTotal: number;
  subtotal: number;
  expectedAt: string | null;
  orderedAt: string | null;
  createdAt: string;
  note: string | null;
  /** 承認待ちのとき、金額から決まる承認に必要なロール */
  requiredApprovalRoleLabel: string | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    unitCost: number;
    taxRate: number;
    receivedQuantity: number;
    /** 在庫連動明細の変換（在庫単位・仕入単位→在庫単位の係数。在庫非連動なら明細の単位・1） */
    stockUnit: string;
    factor: number;
  }[];
}

/** 発注書の中身（/app/purchases/[id]） */
export async function loadPurchaseOrderDetail(supabase: Supabase, organizationId: string, id: string): Promise<PurchaseOrderDetail | null> {
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*, vendors(name), stores(name, address, phone)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!po) return null;

  const { data: itemsData } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', id)
    .order('created_at');
  const items = itemsData ?? [];

  // 在庫連動明細の変換情報（仕入単位・在庫単位・変換係数）を入荷プレビュー用に取得
  const invItemIds = [...new Set(items.map((i) => i.inventory_item_id).filter((v): v is string => !!v))];
  let conversionMap = new Map<string, { stockUnit: string; purchaseUnit: string | null; factor: number }>();
  if (invItemIds.length > 0) {
    const { data: invItems } = await supabase
      .from('inventory_items')
      .select('id, unit, purchase_unit, purchase_to_stock_factor')
      .in('id', invItemIds);
    conversionMap = new Map(
      (invItems ?? []).map((i) => [
        i.id as string,
        { stockUnit: i.unit as string, purchaseUnit: i.purchase_unit as string | null, factor: Number(i.purchase_to_stock_factor) || 1 },
      ])
    );
  }

  const status = po.status as PoStatus;
  const storeInfo = po.stores as unknown as { name: string; address: string | null; phone: string | null } | null;

  // 承認待ち（requested）の場合、金額から必要承認ロールを解決してヒント表示する
  let requiredApprovalRoleLabel: string | null = null;
  if (status === 'requested') {
    const { data: rulesData } = await supabase
      .from('approval_rules')
      .select('target, min_amount, max_amount, approver_role, allow_self_approve')
      .eq('organization_id', organizationId)
      .eq('target', 'purchase_order');
    const rules: ApprovalRuleLike[] = (rulesData ?? []).map((r) => ({
      target: r.target as ApprovalRuleLike['target'],
      minAmount: r.min_amount as number,
      maxAmount: r.max_amount as number | null,
      approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
      allowSelfApprove: r.allow_self_approve as boolean,
    }));
    const rule = resolveApprovalRule(rules, 'purchase_order', po.total);
    requiredApprovalRoleLabel = rule ? ROLE_LABELS[rule.approverRole] : null;
  }

  return {
    id: po.id as string,
    poNo: Number(po.po_no),
    status,
    storeId: po.store_id as string,
    vendorName: (po.vendors as unknown as { name: string } | null)?.name ?? '',
    storeName: storeInfo?.name ?? '',
    storeAddress: storeInfo?.address ?? null,
    storePhone: storeInfo?.phone ?? null,
    total: Number(po.total),
    taxTotal: Number(po.tax_total),
    subtotal: Number(po.total) - Number(po.tax_total),
    expectedAt: po.expected_at as string | null,
    orderedAt: po.ordered_at as string | null,
    createdAt: po.created_at as string,
    note: po.note as string | null,
    requiredApprovalRoleLabel,
    items: items.map((i) => {
      const conv = i.inventory_item_id ? conversionMap.get(i.inventory_item_id as string) : undefined;
      return {
        id: i.id as string,
        name: i.name as string,
        quantity: Number(i.quantity),
        unit: i.unit as string,
        unitCost: Number(i.unit_cost),
        taxRate: Number(i.tax_rate),
        receivedQuantity: Number(i.received_quantity),
        stockUnit: conv?.stockUnit ?? (i.unit as string),
        factor: conv?.factor ?? 1,
      };
    }),
  };
}
