import type { Metadata } from 'next';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { FixedAssetsPanel, type AssetRow } from '@/components/accounting/fixed-assets-panel';
import type { AssetStatus, DepreciationMethod } from '@/components/accounting/labels';

export const metadata: Metadata = { title: '固定資産 | 会計' };

export default async function FixedAssetsPage() {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();

  const { data } = await supabase
    .from('fixed_assets')
    .select('id, name, acquired_on, acquisition_cost, useful_life_years, depreciation_method, store_id, status, disposed_on, note, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('acquired_on', { ascending: false });

  const rows: AssetRow[] = (data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    acquiredOn: a.acquired_on as string,
    acquisitionCost: a.acquisition_cost as number,
    usefulLifeYears: a.useful_life_years as number | null,
    depreciationMethod: a.depreciation_method as DepreciationMethod,
    storeId: a.store_id as string | null,
    storeName: (a.stores as unknown as { name: string } | null)?.name ?? null,
    status: a.status as AssetStatus,
    disposedOn: a.disposed_on as string | null,
    note: a.note as string | null,
  }));

  return (
    <div>
      <PageHeader title="固定資産" description="取得した資産の台帳を管理します（減価償却の自動計算は未対応）" />
      <FixedAssetsPanel initial={rows} stores={ctx.stores} />
    </div>
  );
}
