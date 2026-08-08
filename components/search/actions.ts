'use server';

import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface SearchResultGroup {
  key: string;
  label: string;
  items: SearchResultItem[];
}

const LIMIT = 5;
/** 予約・注文の一覧ページはデフォルトで期間を絞り込んでいるため、検索結果が確実に表示されるよう広い期間を明示する */
const WIDE_FROM = '2000-01-01';
const WIDE_TO = '2099-12-31';

function escapeLike(value: string): string {
  return value.replace(/[%_,()]/g, (c) => `\\${c}`);
}

/**
 * グローバル検索（コマンドパレット用）。
 * ユーザーのRLSクライアントで実行し、organization_id / store_id を明示的にも絞り込む
 * （RLS + クエリの二重スコープ）。
 */
export async function globalSearch(query: string): Promise<SearchResultGroup[]> {
  const ctx = await requireMember();
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const orgId = ctx.organizationId;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const like = `%${escapeLike(q)}%`;
  const orderNo = /^#?\d+$/.test(q) ? Number(q.replace(/^#/, '')) : null;

  const [customersRes, reservationsRes, ordersRes, menuItemsRes, invoicesRes, staffRes, vendorsRes] =
    await Promise.all([
      supabase
        .from('customers')
        .select('id, name, name_kana, phone')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .or(`name.ilike.${like},name_kana.ilike.${like},phone.ilike.${like}`)
        .limit(LIMIT),
      storeIds.length > 0
        ? supabase
            .from('reservations')
            .select('id, guest_name, code, reserved_date, start_at, store_id')
            .eq('organization_id', orgId)
            .in('store_id', storeIds)
            .or(`guest_name.ilike.${like},code.ilike.${like}`)
            .order('start_at', { ascending: false })
            .limit(LIMIT)
        : Promise.resolve({ data: [] as { id: string; guest_name: string; code: string; reserved_date: string; start_at: string; store_id: string }[] }),
      storeIds.length > 0 && orderNo != null
        ? supabase
            .from('orders')
            .select('id, order_no, total, business_date, store_id')
            .eq('organization_id', orgId)
            .in('store_id', storeIds)
            .eq('order_no', orderNo)
            .limit(LIMIT)
        : Promise.resolve({ data: [] as { id: string; order_no: number; total: number; business_date: string; store_id: string }[] }),
      supabase
        .from('menu_items')
        .select('id, name, price')
        .eq('organization_id', orgId)
        .neq('status', 'deleted')
        .ilike('name', like)
        .limit(LIMIT),
      supabase
        .from('invoices')
        .select('id, vendor_name, invoice_no, amount, vendor_id')
        .eq('organization_id', orgId)
        .or(`vendor_name.ilike.${like},invoice_no.ilike.${like}`)
        .limit(LIMIT),
      supabase
        .from('memberships')
        .select('id, profile_id, role, profiles!inner(display_name)')
        .eq('organization_id', orgId)
        .neq('status', 'suspended')
        .ilike('profiles.display_name', like)
        .limit(LIMIT),
      supabase
        .from('vendors')
        .select('id, name, contact_name')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .ilike('name', like)
        .limit(LIMIT),
    ]);

  const groups: SearchResultGroup[] = [];

  const customers = customersRes.data ?? [];
  if (customers.length > 0) {
    groups.push({
      key: 'customers',
      label: '顧客',
      items: customers.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: [c.name_kana, c.phone].filter(Boolean).join(' / ') || undefined,
        href: `/app/customers/${c.id}`,
      })),
    });
  }

  const reservations = reservationsRes.data ?? [];
  if (reservations.length > 0) {
    groups.push({
      key: 'reservations',
      label: '予約',
      items: reservations.map((r) => ({
        id: r.id,
        title: `${r.guest_name} 様`,
        subtitle: `${r.code}｜${r.reserved_date}`,
        // 予約リストの q は guest_name / guest_phone のみを対象にフィルタするため、
        // 検索結果からの遷移も guest_name（code は対象外）で絞り込む
        href: `/app/reservations/list?q=${encodeURIComponent(r.guest_name)}&from=${WIDE_FROM}&to=${WIDE_TO}`,
      })),
    });
  }

  const orders = ordersRes.data ?? [];
  if (orders.length > 0) {
    groups.push({
      key: 'orders',
      label: '注文',
      items: orders.map((o) => ({
        id: o.id,
        title: `注文 #${o.order_no}`,
        subtitle: `${o.business_date}｜¥${o.total.toLocaleString('ja-JP')}`,
        href: `/app/orders?q=${o.order_no}&from=${WIDE_FROM}&to=${WIDE_TO}`,
      })),
    });
  }

  const menuItems = menuItemsRes.data ?? [];
  if (menuItems.length > 0) {
    groups.push({
      key: 'menu_items',
      label: '商品',
      items: menuItems.map((m) => ({
        id: m.id,
        title: m.name,
        subtitle: `¥${m.price.toLocaleString('ja-JP')}`,
        href: `/app/settings/menu`,
      })),
    });
  }

  const invoices = invoicesRes.data ?? [];
  if (invoices.length > 0) {
    groups.push({
      key: 'invoices',
      label: '請求書',
      items: invoices.map((i) => ({
        id: i.id,
        title: i.vendor_name,
        subtitle: [i.invoice_no, `¥${i.amount.toLocaleString('ja-JP')}`].filter(Boolean).join(' / '),
        href: i.vendor_id ? `/app/invoices?tab=invoices&vendor=${i.vendor_id}` : '/app/invoices',
      })),
    });
  }

  const staffRows = (staffRes.data ?? []) as unknown as {
    id: string;
    profile_id: string;
    role: string;
    profiles: { display_name: string } | { display_name: string }[] | null;
  }[];
  if (staffRows.length > 0) {
    groups.push({
      key: 'staff',
      label: 'スタッフ',
      items: staffRows.map((s) => {
        const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
        return {
          id: s.id,
          title: profile?.display_name ?? '不明なスタッフ',
          subtitle: s.role,
          href: '/app/staff',
        };
      }),
    });
  }

  const vendors = vendorsRes.data ?? [];
  if (vendors.length > 0) {
    groups.push({
      key: 'vendors',
      label: '仕入先',
      items: vendors.map((v) => ({
        id: v.id,
        title: v.name,
        subtitle: v.contact_name ?? undefined,
        href: `/app/vendors?q=${encodeURIComponent(v.name)}`,
      })),
    });
  }

  return groups;
}
