import type { Metadata } from 'next';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { FixedAssetsPanel } from '@/components/accounting/fixed-assets-panel';
import { loadFixedAssetsPage } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '固定資産 | 会計' };

export default async function FixedAssetsPage() {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();

  // 読み込みは lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const rows = await loadFixedAssetsPage(supabase, ctx);

  return (
    <div>
      <PageHeader title="固定資産" description="取得した資産の台帳を管理します（減価償却の自動計算は未対応）" />
      <FixedAssetsPanel initial={rows} stores={ctx.stores} />
    </div>
  );
}
