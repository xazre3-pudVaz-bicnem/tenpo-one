import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
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

  // 本番店舗サマリー（環境・稼働状況）
  const onboardingCountQuery = (col: string, val: string) =>
    admin.from('store_onboarding').select('store_id', { count: 'exact', head: true }).eq(col, val);
  const [prodRes, liveRes, pilotRes, allRes] = await Promise.all([
    onboardingCountQuery('environment', 'production'),
    onboardingCountQuery('stage', 'live'),
    onboardingCountQuery('environment', 'pilot'),
    admin.from('store_onboarding').select('store_id', { count: 'exact', head: true }),
  ]);
  const summary = {
    production: prodRes.count ?? 0,
    live: liveRes.count ?? 0,
    pilot: pilotRes.count ?? 0,
    total: allRes.count ?? 0,
  };

  // Go Live未完了アラート: 本番/パイロットで未稼働(live/cancelled以外)の店舗
  const { data: attentionRows } = await admin
    .from('store_onboarding')
    .select('store_id, environment, stage, created_at, stores!inner(name, organizations(name))')
    .in('environment', ['production', 'pilot'])
    .not('stage', 'in', '(live,cancelled)')
    .order('created_at', { ascending: true })
    .limit(50);
  const attention = (attentionRows ?? []) as unknown as {
    store_id: string; environment: Environment; stage: Stage; created_at: string;
    stores: { name: string; organizations: { name: string } | null } | null;
  }[];

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

      {/* 本番店舗サマリー */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="全店舗" value={summary.total} tone="navy" />
        <SummaryTile label="本番(production)" value={summary.production} tone="success" />
        <SummaryTile label="本番稼働中(live)" value={summary.live} tone="success" />
        <SummaryTile label="パイロット" value={summary.pilot} tone="warning" />
      </div>

      {/* Go Live 未完了アラート */}
      {attention.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            Go Live 未完了（本番・パイロットで未稼働）：{attention.length}店舗
          </p>
          <ul className="mt-2 space-y-1">
            {attention.slice(0, 8).map((a) => (
              <li key={a.store_id} className="flex items-center justify-between gap-2 text-xs">
                <Link href={`/admin/tenants/${a.store_id}`} className="font-medium text-amber-900 hover:underline">
                  {a.stores?.name ?? '—'}
                  <span className="ml-1 text-amber-700/70">（{a.stores?.organizations?.name ?? ''}）</span>
                </Link>
                <span className="flex items-center gap-2 text-amber-700">
                  <Badge tone={ENV_TONE[a.environment]}>{ENVIRONMENT_LABELS[a.environment]}</Badge>
                  <Badge tone={STAGE_TONE[a.stage]}>{STAGE_LABELS[a.stage]}</Badge>
                </span>
              </li>
            ))}
          </ul>
          {attention.length > 8 && <p className="mt-1 text-xs text-amber-700/70">ほか {attention.length - 8} 店舗</p>}
          <p className="mt-2 text-xs text-amber-700/80">各店舗の詳細で導入チェックリストを確認し、Critical項目を満たすと Go Live 承認ができます。</p>
        </div>
      )}

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

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'navy' | 'success' | 'warning' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-navy';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
