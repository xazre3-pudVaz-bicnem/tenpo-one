import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsBackLink } from '@/components/settings/back-link';
import { TaxRatesPanel, type TaxRateRow } from '@/components/settings/tax-rates-panel';

export const metadata: Metadata = { title: '税率 | 設定' };

export default async function TaxSettingsPage() {
  const ctx = await requirePermission('store.settings');

  const supabase = await createClient();
  const { data } = await supabase
    .from('tax_rates')
    .select('id, name, rate, is_reduced, is_inclusive, is_default')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .order('name');

  const rows: TaxRateRow[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    rate: Number(r.rate),
    isReduced: r.is_reduced,
    isInclusive: r.is_inclusive,
    isDefault: r.is_default,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="税率" description={ctx.organizationName ?? ''} />
      <TaxRatesPanel initial={rows} />
    </div>
  );
}
