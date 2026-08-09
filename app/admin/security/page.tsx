import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { listAllAuthUsers } from '../_utils';
import { formatDateTime, yen } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';

export const metadata: Metadata = { title: 'セキュリティ' };

// 監視のしきい値
const LARGE_REFUND_YEN = 30000; // これ以上の返金を監視対象として表示
const LOOKBACK_DAYS = 14;
const ROW_LIMIT = 25;

// 監査ログのうちセキュリティ上重要なアクション/対象
const SENSITIVE_TABLES = ['memberships', 'employee_confidential', 'profiles', 'feature_flags'];

const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
};

function daysAgoIso(days: number): string {
  // Date演算のみ（Date.now非依存の相対計算は不可のため new Date を利用）
  return new Date(Date.now() - days * 86400000).toISOString();
}

export default async function SecurityDashboardPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const since = daysAgoIso(LOOKBACK_DAYS);

  const [errorsRes, refundsRes, auditRes, authRes] = await Promise.all([
    // 1) セキュリティ関連エラー（critical 全件 + 認可/認証系ルートの error）
    admin
      .from('system_errors')
      .select('id, error_id, route, severity, message, organization_id, created_at')
      .gte('created_at', since)
      .or('severity.eq.critical,route.ilike.%auth%,route.ilike.%permission%,route.ilike.%login%,route.ilike.%refund%')
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),
    // 2) 高額返金の監視（全社横断）
    admin
      .from('refunds')
      .select('id, amount, method, reason, business_date, created_at, stores(name), organizations(name)')
      .gte('amount', LARGE_REFUND_YEN)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),
    // 3) 権限・機密操作の監査
    admin
      .from('audit_logs')
      .select('id, action, actor_role, target_table, target_id, note, organization_id, ip, created_at')
      .in('target_table', SENSITIVE_TABLES)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),
    // 4) 直近サインイン（auth.users）
    listAllAuthUsers(admin, { maxPages: 5 }),
  ]);

  const errors = errorsRes.data ?? [];
  const refunds = (refundsRes.data ?? []) as unknown as {
    id: string; amount: number; method: string; reason: string; business_date: string; created_at: string;
    stores: { name: string } | null; organizations: { name: string } | null;
  }[];
  const audits = auditRes.data ?? [];
  const recentLogins = [...authRes.users]
    .filter((u) => u.lastSignInAt)
    .sort((a, b) => (b.lastSignInAt ?? '').localeCompare(a.lastSignInAt ?? ''))
    .slice(0, 15);

  return (
    <div className="space-y-6">
      <PageHeader
        title="セキュリティダッシュボード"
        description={`直近${LOOKBACK_DAYS}日の監視イベント（CYPRESS運営限定）。失敗ログインの網羅監視はSupabaseログドレイン設定が必要です（OWNER-ACTION参照）。`}
      />

      {/* サマリ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="セキュリティ関連エラー" value={errors.length} tone={errors.some((e) => e.severity === 'critical') ? 'danger' : errors.length ? 'warning' : 'success'} />
        <SummaryCard label={`高額返金 (¥${LARGE_REFUND_YEN.toLocaleString()}〜)`} value={refunds.length} tone={refunds.length ? 'warning' : 'success'} />
        <SummaryCard label="権限・機密操作" value={audits.length} tone={audits.length ? 'primary' : 'success'} />
        <SummaryCard label="直近サインイン" value={recentLogins.length} tone="gray" />
      </div>

      {/* 1) セキュリティ関連エラー */}
      <Card>
        <CardHeader>
          <CardTitle>セキュリティ関連エラー</CardTitle>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <EmptyState title="該当するエラーはありません" description={`直近${LOOKBACK_DAYS}日でcritical・認証/認可系のエラーは記録されていません。`} />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr><Th>日時</Th><Th>重大度</Th><Th>ルート</Th><Th>エラーID</Th><Th>メッセージ</Th></Tr>
                </THead>
                <TBody>
                  {errors.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(e.created_at)}</Td>
                      <Td><Badge tone={SEVERITY_TONE[e.severity] ?? 'gray'}>{e.severity}</Badge></Td>
                      <Td className="whitespace-nowrap text-gray-600">{e.route ?? '—'}</Td>
                      <Td className="whitespace-nowrap font-mono text-xs">{e.error_id}</Td>
                      <Td className="max-w-md truncate text-gray-600" title={e.message}>{e.message}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* 2) 高額返金の監視 */}
      <Card>
        <CardHeader>
          <CardTitle>高額返金の監視</CardTitle>
        </CardHeader>
        <CardContent>
          {refunds.length === 0 ? (
            <EmptyState title="高額返金はありません" description={`直近${LOOKBACK_DAYS}日で¥${LARGE_REFUND_YEN.toLocaleString()}以上の返金はありません。`} />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr><Th>日時</Th><Th>企業</Th><Th>店舗</Th><Th className="text-right">金額</Th><Th>方法</Th><Th>理由</Th></Tr>
                </THead>
                <TBody>
                  {refunds.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                      <Td className="whitespace-nowrap">{r.organizations?.name ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{r.stores?.name ?? '—'}</Td>
                      <Td className="text-right font-medium text-danger">{yen(r.amount)}</Td>
                      <Td>{r.method}</Td>
                      <Td className="max-w-xs truncate text-gray-600" title={r.reason}>{r.reason}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* 3) 権限・機密操作の監査 */}
      <Card>
        <CardHeader>
          <CardTitle>権限・機密操作の監査</CardTitle>
        </CardHeader>
        <CardContent>
          {audits.length === 0 ? (
            <EmptyState title="該当する操作はありません" description={`直近${LOOKBACK_DAYS}日で権限変更・機密テーブル（メンバー/従業員機密/プロフィール/機能フラグ）の操作は記録されていません。`} />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr><Th>日時</Th><Th>アクション</Th><Th>実行ロール</Th><Th>対象</Th><Th>IP</Th><Th>備考</Th></Tr>
                </THead>
                <TBody>
                  {audits.map((a) => (
                    <Tr key={a.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(a.created_at)}</Td>
                      <Td className="whitespace-nowrap font-medium">{a.action}</Td>
                      <Td className="whitespace-nowrap text-gray-600">{a.actor_role ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-gray-600">{a.target_table}</Td>
                      <Td className="whitespace-nowrap font-mono text-xs text-gray-500">{a.ip ?? '—'}</Td>
                      <Td className="max-w-xs truncate text-gray-600" title={a.note ?? ''}>{a.note ?? '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* 4) 直近サインイン */}
      <Card>
        <CardHeader>
          <CardTitle>直近サインイン</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLogins.length === 0 ? (
            <EmptyState title="サインイン記録がありません" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr><Th>メールアドレス</Th><Th>最終サインイン</Th></Tr>
                </THead>
                <TBody>
                  {recentLogins.map((u) => (
                    <Tr key={u.id}>
                      <Td className="whitespace-nowrap">{u.email ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-gray-600">{u.lastSignInAt ? formatDateTime(u.lastSignInAt) : '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'primary' ? 'text-primary' : tone === 'success' ? 'text-success' : 'text-navy';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
