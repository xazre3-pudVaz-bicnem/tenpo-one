import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';

export const metadata: Metadata = { title: '状態' };

interface HealthResponse {
  status: 'ok' | 'degraded';
  app: 'ok';
  db: 'ok' | 'error' | 'unconfigured';
  dbLatencyMs: number | null;
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

const DB_LABEL: Record<HealthResponse['db'], { label: string; tone: BadgeTone }> = {
  ok: { label: '正常', tone: 'success' },
  error: { label: 'エラー', tone: 'danger' },
  unconfigured: { label: '未設定', tone: 'gray' },
};

// audit_logs に重大度フィールドは無いため、操作名から注意が必要そうな操作を簡易抽出する
const ATTENTION_ACTION_PATTERN = /suspend|fail|error|reject|delete|cancel/i;

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export default async function AdminStatusPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const since24h = hoursAgoIso(24);

  const [health, webhookFailures24hRes, webhookFailuresTotalRes, recentWebhookFailuresRes, auditLogsRes] =
    await Promise.all([
      fetchHealth(),
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', since24h),
      admin.from('webhook_events').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      admin
        .from('webhook_events')
        .select('id, provider, event_type, error, created_at')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(10),
      admin
        .from('audit_logs')
        .select('id, organization_id, action, actor_role, note, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

  const attentionLogs = (auditLogsRes.data ?? []).filter((l) => ATTENTION_ACTION_PATTERN.test(l.action)).slice(0, 10);

  const orgIds = [...new Set(attentionLogs.map((l) => l.organization_id).filter((v): v is string => !!v))];
  let orgNameById = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from('organizations').select('id, name').in('id', orgIds);
    orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  }

  return (
    <div>
      <PageHeader title="状態" description="App / DBの疎通状況と、直近のWebhook失敗・要注意な操作ログを確認できます。" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>App / DB 状態</CardTitle>
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
                  <Badge tone={DB_LABEL[health.data.db].tone}>{DB_LABEL[health.data.db].label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">DBレイテンシ</span>
                  <span className="tabular-nums text-navy">
                    {health.data.dbLatencyMs != null ? `${health.data.dbLatencyMs}ms` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">応答時間</span>
                  <span className="tabular-nums text-navy">{health.data.responseMs}ms</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                  <span className="text-gray-500">取得時刻</span>
                  <span className="text-xs text-gray-500">{formatDateTime(health.data.timestamp)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook失敗件数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface px-3 py-3 text-center">
                <p className="text-2xl font-bold text-navy tabular-nums">{webhookFailures24hRes.count ?? 0}</p>
                <p className="mt-1 text-[11px] text-gray-500">直近24時間</p>
              </div>
              <div className="rounded-lg bg-surface px-3 py-3 text-center">
                <p className="text-2xl font-bold text-navy tabular-nums">{webhookFailuresTotalRes.count ?? 0}</p>
                <p className="mt-1 text-[11px] text-gray-500">累計</p>
              </div>
            </div>
            {(recentWebhookFailuresRes.data ?? []).length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                {(recentWebhookFailuresRes.data ?? []).slice(0, 5).map((w) => (
                  <li key={w.id} className="text-xs text-gray-500">
                    <span className="font-mono text-gray-400">{formatDateTime(w.created_at)}</span>
                    {' — '}
                    <span className="text-navy">
                      {w.provider}/{w.event_type}
                    </span>
                    {w.error && <span className="block truncate text-danger">{w.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>要注意な直近の操作ログ</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {attentionLogs.length === 0 ? (
              <div className="p-5">
                <EmptyState className="border-0 py-6" title="該当する操作はありません" />
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {attentionLogs.map((l) => (
                  <li key={l.id} className="px-4 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="warning">{l.action}</Badge>
                      <span className="text-gray-400">{formatDateTime(l.created_at)}</span>
                    </div>
                    <p className="mt-1 text-gray-500">
                      {l.organization_id ? (orgNameById.get(l.organization_id) ?? l.organization_id) : 'システム'}
                      {l.actor_role ? `（${l.actor_role}）` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
