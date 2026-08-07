import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { VendorForm } from './vendor-form';
import { VendorTable, type VendorRow } from './vendor-table';

export const metadata: Metadata = { title: '仕入先' };

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const ctx = await requireFeature('inventory');
  const supabase = await createClient();
  const sp = await searchParams;

  let query = supabase.from('vendors').select('*').eq('organization_id', ctx.organizationId);
  query = sp.status ? query.eq('status', sp.status) : query.neq('status', 'deleted');
  if (sp.q) query = query.ilike('name', `%${sp.q}%`);
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
      .eq('organization_id', ctx.organizationId)
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
      .eq('organization_id', ctx.organizationId)
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
      .eq('organization_id', ctx.organizationId)
      .in('vendor_id', vendorIds)
      .not('status', 'in', '(received,cancelled)');
    for (const r of poData ?? []) {
      activePoCounts.set(r.vendor_id, (activePoCounts.get(r.vendor_id) ?? 0) + 1);
    }
  }

  const rows: VendorRow[] = vendors.map((v) => ({
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

  return (
    <div>
      <PageHeader title="仕入先" description="発注・請求書で使用する取引先マスタを管理します" actions={<VendorForm />} />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">検索</label>
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="仕入先名で検索" className="w-56" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">状態</label>
          <Select name="status" defaultValue={sp.status ?? ''} className="w-36">
            <option value="">すべて（削除済み除く）</option>
            <option value="active">取引中</option>
            <option value="inactive">休止</option>
            <option value="deleted">削除済み</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          検索する
        </Button>
      </form>

      <VendorTable rows={rows} />
    </div>
  );
}
