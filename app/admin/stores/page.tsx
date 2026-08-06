import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';

export const metadata: Metadata = { title: '全店舗' };

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: '営業中', tone: 'success' },
  suspended: { label: '停止中', tone: 'warning' },
  closed: { label: '閉店', tone: 'danger' },
};

interface StoreRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  booking_enabled: boolean;
  created_at: string;
  organization_id: string;
  organizations: { name: string } | { name: string }[] | null;
}

function orgName(row: StoreRow): string {
  const org = row.organizations;
  if (!org) return '—';
  return Array.isArray(org) ? (org[0]?.name ?? '—') : org.name;
}

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; org?: string }>;
}) {
  await requireCypressAdmin();
  const { q, org } = await searchParams;
  const admin = createAdminClient();

  const { data: organizations } = await admin.from('organizations').select('id, name').order('name');

  let query = admin
    .from('stores')
    .select('id, name, slug, status, booking_enabled, created_at, organization_id, organizations(name)')
    .order('created_at', { ascending: false });
  if (q) query = query.ilike('name', `%${q}%`);
  if (org) query = query.eq('organization_id', org);

  const { data } = await query;
  const rows = (data ?? []) as unknown as StoreRow[];

  return (
    <div>
      <PageHeader title="全店舗" description="全契約企業の店舗一覧です。" />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={q ?? ''} placeholder="店舗名で検索" className="w-full sm:w-56" />
        <Select name="org" defaultValue={org ?? ''} className="w-full sm:w-56">
          <option value="">すべての企業</option>
          {(organizations ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">絞り込む</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="該当する店舗がありません" description="検索条件を変更してお試しください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>店舗名</Th>
                <Th>企業名</Th>
                <Th>状態</Th>
                <Th>オンライン予約</Th>
                <Th>作成日</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((s) => {
                const status = STATUS_LABEL[s.status] ?? { label: s.status, tone: 'gray' as BadgeTone };
                return (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-medium text-navy">{s.name}</p>
                      <p className="text-xs text-gray-400">/{s.slug}</p>
                    </Td>
                    <Td>{orgName(s)}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={s.booking_enabled ? 'success' : 'gray'}>
                        {s.booking_enabled ? '有効' : '無効'}
                      </Badge>
                    </Td>
                    <Td>{formatDate(s.created_at)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
