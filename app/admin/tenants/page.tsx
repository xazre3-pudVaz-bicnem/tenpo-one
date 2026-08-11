import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  ENVIRONMENTS,
  STAGES,
  ENVIRONMENT_LABELS,
  STAGE_LABELS,
  type Environment,
  type Stage,
} from '@/lib/tenant-onboarding';
import { TenantFilters } from '@/components/admin/tenant-filters';
import { CreateTenantTrigger } from '@/components/admin/create-tenant-dialog';

export const metadata: Metadata = { title: '導入店舗' };

const PAGE_SIZE = 20;

const ENV_TONE: Record<Environment, BadgeTone> = { demo: 'gray', test: 'primary', pilot: 'warning', production: 'success' };
const STAGE_TONE: Record<Stage, BadgeTone> = {
  draft: 'gray', onboarding: 'primary', configuration: 'primary', testing: 'warning',
  pilot: 'warning', ready: 'success', live: 'success', suspended: 'danger', cancelled: 'gray',
};
// ステージ基準の概算進捗（一覧の軽量指標。実チェックリスト%は詳細ページで算出）
const STAGE_PERCENT: Record<Stage, number> = {
  draft: 5, onboarding: 20, configuration: 40, testing: 60, pilot: 75, ready: 90, live: 100, suspended: 0, cancelled: 0,
};

interface TenantRow {
  store_id: string;
  environment: Environment;
  stage: Stage;
  go_live_at: string | null;
  opened_on: string | null;
  updated_at: string;
  stores: { name: string; slug: string; status: string; organization_id: string; organizations: { name: string } | null } | null;
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; env?: string; stage?: string; page?: string }>;
}) {
  await requireCypressAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const env = ENVIRONMENTS.includes(sp.env as Environment) ? (sp.env as Environment) : '';
  const stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : '';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const admin = createAdminClient();

  // 追加ウィザード用の会社・プラン一覧
  const [{ data: orgOptions }, { data: planOptions }] = await Promise.all([
    admin.from('organizations').select('id, name').order('name').limit(500),
    admin.from('plans').select('code, name').eq('is_active', true).order('sort_order'),
  ]);

  // 会社名検索のため、名称一致する org id を先に取得
  let orgIds: string[] = [];
  if (q) {
    const { data: orgs } = await admin.from('organizations').select('id').ilike('name', `%${q}%`).limit(200);
    orgIds = (orgs ?? []).map((o) => o.id);
  }

  let query = admin
    .from('store_onboarding')
    .select(
      'store_id, environment, stage, go_live_at, opened_on, updated_at, stores!inner(name, slug, status, organization_id, organizations(name))',
      { count: 'exact' }
    );
  if (env) query = query.eq('environment', env);
  if (stage) query = query.eq('stage', stage);
  if (q) {
    const esc = q.replace(/[%,()]/g, '');
    const clauses = [`name.ilike.%${esc}%`, `slug.ilike.%${esc}%`];
    // 会社名一致はstores.organization_id in (...) で表現
    const orgClause = orgIds.length ? `,organization_id.in.(${orgIds.join(',')})` : '';
    query = query.or(`${clauses.join(',')}${orgClause}`, { referencedTable: 'stores' });
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as TenantRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseParams = new URLSearchParams();
  if (q) baseParams.set('q', q);
  if (env) baseParams.set('env', env);
  if (stage) baseParams.set('stage', stage);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseParams);
    params.set('page', String(p));
    return `/admin/tenants?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="導入店舗"
        description={`${total}店舗｜TENPO ONEは単一マルチテナントSaaS。店舗ごとのコード複製はしません`}
        actions={<CreateTenantTrigger organizations={orgOptions ?? []} plans={planOptions ?? []} />}
      />

      <TenantFilters
        environments={ENVIRONMENTS.map((e) => ({ value: e, label: ENVIRONMENT_LABELS[e] }))}
        stages={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
        current={{ q, env, stage }}
      />

      {rows.length === 0 ? (
        <EmptyState title="該当する店舗がありません" description="「新規店舗を追加」から導入を開始できます" className="mt-4" />
      ) : (
        <TableWrap className="mt-4">
          <Table>
            <THead>
              <Tr>
                <Th>店舗</Th>
                <Th>会社</Th>
                <Th>環境</Th>
                <Th>ステージ</Th>
                <Th>進捗</Th>
                <Th>利用開始</Th>
                <Th>更新</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.store_id}>
                  <Td>
                    <Link href={`/admin/tenants/${r.store_id}`} className="font-medium text-primary hover:underline">
                      {r.stores?.name ?? '—'}
                    </Link>
                    <p className="font-mono text-xs text-gray-400">{r.stores?.slug}</p>
                  </Td>
                  <Td className="text-gray-600">{r.stores?.organizations?.name ?? '—'}</Td>
                  <Td><Badge tone={ENV_TONE[r.environment]}>{ENVIRONMENT_LABELS[r.environment]}</Badge></Td>
                  <Td><Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABELS[r.stage]}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${STAGE_PERCENT[r.stage]}%` }} />
                      </div>
                      {r.go_live_at && <Badge tone="success">稼働</Badge>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{r.opened_on ? formatDate(r.opened_on) : '—'}</Td>
                  <Td className="whitespace-nowrap text-gray-500">{formatDate(r.updated_at)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">前へ</Link>
          )}
          <span className="text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">次へ</Link>
          )}
        </div>
      )}
    </div>
  );
}
