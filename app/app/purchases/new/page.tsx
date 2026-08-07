import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { PoForm } from '@/components/inventory/po-form';

export const metadata: Metadata = { title: '発注書を作成' };

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const ctx = await requireMember();
  const sp = await searchParams;

  if (!ctx.currentStore) {
    return (
      <div>
        <PageHeader title="発注書を作成" />
        <EmptyState
          title="店舗を選択してください"
          description="発注書は店舗ごとに作成します。ヘッダーの店舗切替から対象店舗を選択してください"
        />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: vendorsData }, { data: itemsData }] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('inventory_items')
      .select('id, name, unit, avg_cost')
      .eq('organization_id', ctx.organizationId)
      .eq('store_id', ctx.currentStore.id)
      .eq('status', 'active')
      .order('name'),
  ]);

  return (
    <div>
      <PageHeader title="発注書を作成" description={`店舗: ${ctx.currentStore.name}`} />
      <PoForm
        storeId={ctx.currentStore.id}
        vendors={vendorsData ?? []}
        inventoryItems={(itemsData ?? []).map((i) => ({ id: i.id, name: i.name, unit: i.unit, avgCost: i.avg_cost }))}
        initialItemId={sp.item}
      />
    </div>
  );
}
