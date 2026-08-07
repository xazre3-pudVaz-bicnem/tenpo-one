import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { FEATURE_LABELS } from '@/lib/features';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SupportAccessForm } from '@/components/admin/support-access-form';
import { logSupportAccess } from './actions';

export const metadata: Metadata = { title: 'サポートアクセス' };

export default async function SupportPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const [{ data: organizations }, { data: flags }] = await Promise.all([
    admin.from('organizations').select('id, name').order('name'),
    admin.from('feature_flags').select('organization_id, flag_key').eq('enabled', false).not('organization_id', 'is', null),
  ]);

  const disabledByOrg = new Map<string, string[]>();
  for (const f of flags ?? []) {
    const orgId = f.organization_id as string;
    const list = disabledByOrg.get(orgId) ?? [];
    list.push(f.flag_key);
    disabledByOrg.set(orgId, list);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <PageHeader
          title="サポートアクセス"
          description="企業データを確認する前に、対象企業とアクセス理由を記録してください。"
        />
        <SupportAccessForm organizations={organizations ?? []} action={logSupportAccess} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>企業別の機能フラグ状態</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(organizations ?? []).length === 0 ? (
            <p className="text-xs text-gray-500">契約企業がありません</p>
          ) : (
            (organizations ?? []).map((o) => {
              const disabled = disabledByOrg.get(o.id) ?? [];
              return (
                <div key={o.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-navy">{o.name}</p>
                  {disabled.length === 0 ? (
                    <p className="mt-1 text-xs text-gray-400">すべての機能が有効です</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {disabled.map((key) => (
                        <Badge key={key} tone="warning">
                          {FEATURE_LABELS[key as keyof typeof FEATURE_LABELS] ?? key} OFF
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
