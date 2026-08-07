import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsBackLink } from '@/components/settings/back-link';
import { LoyaltySettingsForm } from './loyalty-settings-form';
import type { LoyaltySettingsInput } from './actions';

export const metadata: Metadata = { title: 'ポイント設定 | 設定' };

export default async function LoyaltySettingsPage() {
  const ctx = await requirePermission('org.settings');

  const supabase = await createClient();
  const { data } = await supabase
    .from('loyalty_settings')
    .select('enabled, yen_per_point, point_value, expiry_months')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const initial: LoyaltySettingsInput = {
    enabled: data?.enabled ?? false,
    yenPerPoint: data?.yen_per_point ?? 100,
    pointValue: data?.point_value ?? 1,
    expiryMonths: data?.expiry_months ?? null,
  };

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="ポイント設定" description={ctx.organizationName ?? ''} />
      <LoyaltySettingsForm initial={initial} />
    </div>
  );
}
