import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsBackLink } from '@/components/settings/back-link';
import { canWriteAccounting } from '@/components/accounting/roles';
import { AccountsPanel, type AccountRow } from './accounts-panel';

export const metadata: Metadata = { title: '勘定科目 | 設定' };

export default async function AccountsSettingsPage() {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) redirect('/app/settings');

  const supabase = await createClient();
  const { data } = await supabase
    .from('accounts')
    .select('id, code, name, category, sub_type, default_tax_treatment, is_system, sort_order')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');

  const rows: AccountRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    category: r.category as AccountRow['category'],
    subType: r.sub_type as string | null,
    defaultTaxTreatment: r.default_tax_treatment as AccountRow['defaultTaxTreatment'],
    isSystem: r.is_system as boolean,
    sortOrder: r.sort_order as number,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="勘定科目" description={`${ctx.organizationName ?? ''}の勘定科目マスタ（複式簿記の仕訳で使用する科目一覧）`} />
      <AccountsPanel initial={rows} />
    </div>
  );
}
