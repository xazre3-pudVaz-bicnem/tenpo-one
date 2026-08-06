import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { FeatureFlagCreateDialog } from '@/components/admin/feature-flag-create-dialog';
import { FeatureFlagToggle } from '@/components/admin/feature-flag-toggle';

export const metadata: Metadata = { title: '機能フラグ' };

interface FlagRow {
  id: string;
  organization_id: string | null;
  flag_key: string;
  enabled: boolean;
  note: string | null;
  updated_at: string;
}

export default async function FeatureFlagsPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const [{ data: flags }, { data: organizations }] = await Promise.all([
    admin
      .from('feature_flags')
      .select('id, organization_id, flag_key, enabled, note, updated_at')
      .order('flag_key'),
    admin.from('organizations').select('id, name').order('name'),
  ]);

  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));
  const rows = (flags ?? []) as FlagRow[];
  const globalFlags = rows.filter((f) => f.organization_id === null);
  const orgFlags = rows.filter((f) => f.organization_id !== null);

  return (
    <div>
      <PageHeader
        title="機能フラグ"
        description="機能の有効・無効を企業単位、またはグローバルに制御します。"
        actions={<FeatureFlagCreateDialog organizations={organizations ?? []} />}
      />

      <div className="space-y-8">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-navy">グローバル（全企業の既定値）</h2>
          {globalFlags.length === 0 ? (
            <EmptyState title="グローバルフラグはまだありません" className="py-8" />
          ) : (
            <FlagTable rows={globalFlags} orgNameById={orgNameById} />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-navy">企業別</h2>
          {orgFlags.length === 0 ? (
            <EmptyState title="企業別フラグはまだありません" className="py-8" />
          ) : (
            <FlagTable rows={orgFlags} orgNameById={orgNameById} />
          )}
        </section>
      </div>
    </div>
  );
}

function FlagTable({ rows, orgNameById }: { rows: FlagRow[]; orgNameById: Map<string, string> }) {
  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>フラグキー</Th>
            <Th>対象</Th>
            <Th>状態</Th>
            <Th>メモ</Th>
            <Th>更新日時</Th>
            <Th className="text-right">切替</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((f) => (
            <Tr key={f.id}>
              <Td className="font-mono text-xs">{f.flag_key}</Td>
              <Td>{f.organization_id ? (orgNameById.get(f.organization_id) ?? '—') : 'グローバル'}</Td>
              <Td>
                <Badge tone={f.enabled ? 'success' : 'gray'}>{f.enabled ? '有効' : '無効'}</Badge>
              </Td>
              <Td className="max-w-xs truncate text-xs text-gray-500">{f.note ?? '—'}</Td>
              <Td className="text-xs text-gray-500">{formatDateTime(f.updated_at)}</Td>
              <Td>
                <div className="flex justify-end">
                  <FeatureFlagToggle id={f.id} organizationId={f.organization_id} enabled={f.enabled} />
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}
