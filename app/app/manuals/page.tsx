import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { ManualForm } from './manual-form';
import { ManualCatalog, type ManualItem } from './manual-catalog';
import type { ManualCategory } from './labels';

export const metadata: Metadata = { title: 'マニュアル' };

const WRITE_ROLES = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'];

export default async function ManualsPage() {
  const ctx = await requirePermission('dashboard.view');
  const supabase = await createClient();
  const canWrite = WRITE_ROLES.includes(ctx.role);
  const storeIds = ctx.stores.map((s) => s.id);

  const { data: rows } = await supabase
    .from('manuals')
    .select('id, title, category, store_id, file_path, url, note, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .or(storeIds.length > 0 ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : 'store_id.is.null')
    .order('title');

  const manuals: ManualItem[] = (rows ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    category: m.category as ManualCategory,
    storeLabel: m.store_id === null ? '全店共通' : ((m.stores as unknown as { name: string } | null)?.name ?? '店舗'),
    hasFile: !!m.file_path,
    url: m.url,
    note: m.note,
    canDelete: canWrite && (m.store_id === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true),
  }));

  const targetStore = ctx.currentStore ?? ctx.stores[0];

  return (
    <div>
      <PageHeader
        title="マニュアル"
        description="接客・衛生・調理・レジ・勤怠・緊急対応などの手順書を管理します"
        actions={
          canWrite && targetStore && ctx.organizationId ? (
            <ManualForm organizationId={ctx.organizationId} storeId={targetStore.id} storeName={targetStore.name} canTargetAllStores={ctx.role === 'org_owner' || ctx.role === 'hq_admin'} />
          ) : undefined
        }
      />
      <ManualCatalog manuals={manuals} />
    </div>
  );
}
