import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { ImportWizard } from '@/components/import/import-wizard';

export const metadata: Metadata = { title: 'データ取込' };

export default async function DataImportPage() {
  const ctx = await requirePermission('org.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0] ?? null;

  return (
    <div>
      <PageHeader
        title="データ取込"
        description="CSVファイルから商品・顧客・仕入先・在庫品目をまとめて登録します"
      />
      <ImportWizard targetStoreName={targetStore?.name ?? null} hasStore={ctx.stores.length > 0} />
    </div>
  );
}
