import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import pkg from '@/package.json';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = { title: 'システム' };

const PAGE_SIZE = 50;

interface HealthResponse {
  status: 'ok' | 'degraded';
  app: 'ok';
  db: 'ok' | 'error' | 'unconfigured';
  dbLatencyMs: number | null;
  auth: 'ok' | 'unconfigured';
  authAdminConfigured: boolean;
  version: string;
  environment: string;
  responseMs: number;
  timestamp: string;
}

async function getBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

async function fetchHealth(): Promise<{ ok: true; data: HealthResponse } | { ok: false; error: string }> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    const data = (await res.json()) as HealthResponse;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ヘルスチェックの取得に失敗しました' };
  }
}

const STATE_LABEL: Record<'ok' | 'error' | 'unconfigured', { label: string; tone: BadgeTone }> = {
  ok: { label: '正常', tone: 'success' },
  error: { label: 'エラー', tone: 'danger' },
  unconfigured: { label: '未設定', tone: 'gray' },
};

const ORG_STATUS_LABEL: Record<string, string> = {
  trial: 'トライアル',
  active: '契約中',
  suspended: '停止中',
  cancelled: '解約済み',
  pending_deletion: '削除待ち',
};

const SEVERITY_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  warning: { label: '警告', tone: 'warning' },
  error: { label: 'エラー', tone: 'danger' },
  critical: { label: '重大', tone: 'danger' },
};

interface SystemErrorRow {
  id: string;
  error_id: string;
  severity: string;
  message: string;
  route: string | null;
  organization_id: string | null;
  store_id: string | null;
  user_id: string | null;
  request_id: string | null;
  created_at: string;
}

interface MigrationRow {
  version: string;
  name?: string | null;
}

/**
 * supabase_migrations.schema_migrations はPostgREST公開スキーマ外のため、通常は取得できない
 * （プロジェクトのAPI設定でスキーマを公開している場合のみ成功する）。失敗時は「取得不可」を表示する。
 */
async function fetchMigrationStatus(
  admin: ReturnType<typeof createAdminClient>
): Promise<{ ok: true; rows: MigrationRow[] } | { ok: false }> {
  try {
    const { data, error } = await admin
      .schema('supabase_migrations')
      .from('schema_migrations')
      .select('version, name')
      .order('version', { ascending: false })
      .limit(20);
    if (error || !data) return { ok: false };
    return { ok: true, rows: data as MigrationRow[] };
  } catch {
    return { ok: false };
  }
}

export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;

  const [health, migrations, orgStatusRes, storeCountRes, userCountRes, errorsRes] = await Promise.all([
    fetchHealth(),
    fetchMigrationStatus(admin),
    admin.from('organizations').select('status'),
    admin.from('stores').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin
      .from('system_errors')
      .select('id, error_id, severity, message, route, organization_id, store_id, user_id, request_id, created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeFrom + PAGE_SIZE - 1),
  ]);

  const orgStatusCounts = new Map<string, number>();
  for (const row of orgStatusRes.data ?? []) {
    orgStatusCounts.set(row.status, (orgStatusCounts.get(row.status) ?? 0) + 1);
  }
  const totalOrgs = orgStatusRes.data?.length ?? 0;

  const errorRows = (errorsRes.data ?? []) as SystemErrorRow[];
  const errorTotal = errorsRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(errorTotal / PAGE_SIZE));

  const orgIds = [...new Set(errorRows.map((r) => r.organization_id).filter((v): v is string => !!v))];
  let orgNameById = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from('organizations').select('id, name').in('id', orgIds);
    orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  }

  return (
    <div>
      <PageHeader title="システム" description="アプリの稼働状況・マイグレーション適用状況・テナント規模・直近のシステムエラーを確認できます。" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>アプリ情報</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">バージョン</span>
                <span className="font-mono text-navy">{pkg.version}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">環境</span>
                <span className="font-mono text-navy">{health.ok ? health.data.environment : '—'}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-gray-500">取得時刻</span>
                <span className="text-xs text-gray-500">{health.ok ? formatDateTime(health.data.timestamp) : '—'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            {!health.ok ? (
              <EmptyState className="border-0 py-6" title="取得に失敗しました" description={health.error} />
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">App</span>
                  <Badge tone="success">正常</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">DB（Supabase）</span>
                  <Badge tone={STATE_LABEL[health.data.db].tone}>{STATE_LABEL[health.data.db].label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Auth設定</span>
                  <Badge tone={STATE_LABEL[health.data.auth].tone}>{STATE_LABEL[health.data.auth].label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Admin API（service role）</span>
                  <Badge tone={health.data.authAdminConfigured ? 'success' : 'gray'}>
                    {health.data.authAdminConfigured ? '設定済み' : '未設定'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">DBレイテンシ</span>
                  <span className="tabular-nums text-navy">
                    {health.data.dbLatencyMs != null ? `${health.data.dbLatencyMs}ms` : '—'}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>マイグレーション適用状況</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!migrations.ok || migrations.rows.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  className="border-0 py-6"
                  title="取得不可"
                  description="このプロジェクトのAPI設定では supabase_migrations スキーマが公開されていません。"
                />
              </div>
            ) : (
              <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
                {migrations.rows.map((m) => (
                  <li key={m.version} className="px-4 py-2 text-xs">
                    <span className="font-mono text-navy">{m.version}</span>
                    {m.name && <span className="ml-2 text-gray-500">{m.name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
          <p className="text-2xl font-bold text-navy tabular-nums">{totalOrgs}</p>
          <p className="mt-1 text-[11px] text-gray-500">契約企業数</p>
        </div>
        {(['trial', 'active', 'suspended', 'cancelled', 'pending_deletion'] as const).map((status) => (
          <div key={status} className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
            <p className="text-2xl font-bold text-navy tabular-nums">{orgStatusCounts.get(status) ?? 0}</p>
            <p className="mt-1 text-[11px] text-gray-500">{ORG_STATUS_LABEL[status]}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
          <p className="text-2xl font-bold text-navy tabular-nums">{storeCountRes.count ?? 0}</p>
          <p className="mt-1 text-[11px] text-gray-500">店舗数（全企業合計）</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
          <p className="text-2xl font-bold text-navy tabular-nums">{userCountRes.count ?? 0}</p>
          <p className="mt-1 text-[11px] text-gray-500">ユーザー数（全企業合計）</p>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>最近のエラー</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {errorRows.length === 0 ? (
            <div className="p-5">
              <EmptyState className="border-0 py-8" title="エラーの記録はありません" />
            </div>
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>発生日時</Th>
                    <Th>エラーID</Th>
                    <Th>重大度</Th>
                    <Th>ルート</Th>
                    <Th>企業</Th>
                    <Th>メッセージ</Th>
                  </Tr>
                </THead>
                <TBody>
                  {errorRows.map((e) => {
                    const sev = SEVERITY_LABEL[e.severity] ?? { label: e.severity, tone: 'gray' as BadgeTone };
                    return (
                      <Tr key={e.id}>
                        <Td className="text-xs text-gray-500 whitespace-nowrap">{formatDateTime(e.created_at)}</Td>
                        <Td className="font-mono text-xs text-navy">{e.error_id}</Td>
                        <Td>
                          <Badge tone={sev.tone}>{sev.label}</Badge>
                        </Td>
                        <Td className="text-xs text-gray-500">{e.route ?? '—'}</Td>
                        <Td className="text-xs text-gray-500">
                          {e.organization_id ? (orgNameById.get(e.organization_id) ?? e.organization_id) : '—'}
                        </Td>
                        <Td className="max-w-md truncate text-xs text-gray-700" title={e.message}>
                          {e.message}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <p>
            {errorTotal.toLocaleString('ja-JP')}件中 {(rangeFrom + 1).toLocaleString('ja-JP')}〜
            {Math.min(rangeFrom + PAGE_SIZE, errorTotal).toLocaleString('ja-JP')}件を表示
          </p>
          <div className="flex gap-2">
            <Link
              href={`/admin/system?page=${Math.max(1, page - 1)}`}
              aria-disabled={page <= 1}
              className={buttonVariants({ variant: 'secondary', size: 'sm', className: page <= 1 ? 'pointer-events-none opacity-50' : '' })}
            >
              前へ
            </Link>
            <span className="flex items-center px-2 text-xs text-gray-500">
              {page} / {totalPages} ページ
            </span>
            <Link
              href={`/admin/system?page=${Math.min(totalPages, page + 1)}`}
              aria-disabled={page >= totalPages}
              className={buttonVariants({ variant: 'secondary', size: 'sm', className: page >= totalPages ? 'pointer-events-none opacity-50' : '' })}
            >
              次へ
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
