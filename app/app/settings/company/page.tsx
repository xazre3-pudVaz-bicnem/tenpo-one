import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsBackLink } from '@/components/settings/back-link';
import { CompanyForm, type CompanyFormData } from '@/components/settings/company-form';

export const metadata: Metadata = { title: '企業情報 | 設定' };

export default async function CompanySettingsPage() {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('name, name_kana, postal_code, address, phone, billing_info')
    .eq('id', ctx.organizationId)
    .single();

  const billing = (org?.billing_info ?? {}) as { name?: string; email?: string; note?: string };

  const initial: CompanyFormData = {
    name: org?.name ?? '',
    nameKana: org?.name_kana ?? '',
    postalCode: org?.postal_code ?? '',
    address: org?.address ?? '',
    phone: org?.phone ?? '',
    billingName: billing.name ?? '',
    billingEmail: billing.email ?? '',
    billingNote: billing.note ?? '',
  };

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="企業情報" description="契約企業の基本情報と請求情報を管理します。" />
      <CompanyForm initial={initial} />
    </div>
  );
}
