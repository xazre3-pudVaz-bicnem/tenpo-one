import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/page-header';
import { SupportAccessForm } from '@/components/admin/support-access-form';
import { logSupportAccess } from './actions';

export const metadata: Metadata = { title: 'サポートアクセス' };

export default async function SupportPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: organizations } = await admin
    .from('organizations')
    .select('id, name')
    .order('name');

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="サポートアクセス"
        description="企業データを確認する前に、対象企業とアクセス理由を記録してください。"
      />
      <SupportAccessForm organizations={organizations ?? []} action={logSupportAccess} />
    </div>
  );
}
