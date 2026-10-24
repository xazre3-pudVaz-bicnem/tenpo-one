import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadManualsPage } from '@/lib/manuals-server';
import { PageHeader } from '@/components/ui/page-header';
import { ManualForm } from './manual-form';
import { ManualCatalog } from './manual-catalog';

export const metadata: Metadata = { title: 'マニュアル' };

export default async function ManualsPage() {
  const ctx = await requirePermission('dashboard.view');
  const supabase = await createClient();
  // 読み込みは lib/manuals-server.ts（iPad ネイティブと同じ。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）
  const { canWrite, manuals, targetStore, canTargetAllStores } = await loadManualsPage(ctx, supabase);

  return (
    <div>
      <PageHeader
        title="マニュアル"
        description="接客・衛生・調理・レジ・勤怠・緊急対応などの手順書を管理します"
        actions={
          canWrite && targetStore && ctx.organizationId ? (
            <ManualForm organizationId={ctx.organizationId} storeId={targetStore.id} storeName={targetStore.name} canTargetAllStores={canTargetAllStores} />
          ) : undefined
        }
      />
      <ManualCatalog manuals={manuals} />
    </div>
  );
}
