import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate, formatDateTime, todayJst } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { CreateStoreDialog } from '@/components/admin/create-store-dialog';
import { AddOrgMemberDialog } from '@/components/admin/add-org-member-dialog';
import { FeatureFlagMatrix } from '@/components/admin/feature-flag-matrix';
import { OrgPlanForm } from '@/components/admin/org-plan-form';
import { OrganizationRowActions } from '@/components/admin/organization-row-actions';
import { SubscriptionMockForm } from '@/components/admin/subscription-mock-form';
import { ApplyPlanDefaultsButton } from '@/components/admin/apply-plan-defaults-button';
import type { SaasSubscriptionStatus } from '../actions';
import { listAllAuthUsers } from '../../_utils';

const SUBSCRIPTION_STATUS_LABEL: Record<SaasSubscriptionStatus, { label: string; tone: BadgeTone }> = {
  inactive: { label: '未契約', tone: 'gray' },
  trialing: { label: 'トライアル中', tone: 'primary' },
  active: { label: '契約中', tone: 'success' },
  past_due: { label: '支払遅延', tone: 'danger' },
  canceled: { label: '解約済み', tone: 'gray' },
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export const metadata: Metadata = { title: '企業詳細' };

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: 'トライアル', tone: 'primary' },
  active: { label: '契約中', tone: 'success' },
  suspended: { label: '停止中', tone: 'warning' },
  cancelled: { label: '解約済み', tone: 'danger' },
};

const STORE_STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: '営業中', tone: 'success' },
  suspended: { label: '停止中', tone: 'warning' },
  closed: { label: '閉店', tone: 'danger' },
};

interface MembershipRow {
  id: string;
  profile_id: string;
  role: string;
  status: string;
  created_at: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCypressAdmin();
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: org }, { data: plans }, { data: stores }, { data: memberships }, { data: flags }, authUsers] =
    await Promise.all([
      admin
        .from('organizations')
        .select(
          'id, name, name_kana, plan_code, status, is_demo, created_at, postal_code, address, phone, contact_email, contact_phone, billing_info, onboarding'
        )
        .eq('id', id)
        .maybeSingle(),
      admin.from('plans').select('code, name, features').eq('is_active', true).order('sort_order'),
      admin
        .from('stores')
        .select('id, name, slug, status, booking_enabled, created_at')
        .eq('organization_id', id)
        .order('created_at'),
      admin
        .from('memberships')
        .select('id, profile_id, role, status, created_at, profiles(display_name)')
        .eq('organization_id', id)
        .order('created_at'),
      admin.from('feature_flags').select('flag_key, enabled').eq('organization_id', id),
      listAllAuthUsers(admin),
    ]);

  if (!org) notFound();

  const today = todayJst();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [
    { count: activeUserCount },
    { count: monthReservationsCount },
    { count: monthOrdersCount },
    { count: documentsCount },
    { data: documentSizeRows },
    { data: subscription },
  ] = await Promise.all([
    admin.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', id).eq('status', 'active'),
    admin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', id)
      .gte('reserved_date', monthStart)
      .lte('reserved_date', today),
    admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', id)
      .gte('business_date', monthStart)
      .lte('business_date', today),
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', id).neq('status', 'deleted'),
    admin.from('documents').select('size_bytes').eq('organization_id', id).neq('status', 'deleted'),
    admin
      .from('saas_subscriptions')
      .select('status, plan_code, current_period_start, current_period_end')
      .eq('organization_id', id)
      .maybeSingle(),
  ]);

  const totalStorageBytes = (documentSizeRows ?? []).reduce((sum, d) => sum + (d.size_bytes ?? 0), 0);

  const planNameByCode = new Map((plans ?? []).map((p) => [p.code, p.name]));
  const statusMeta = STATUS_LABEL[org.status] ?? { label: org.status, tone: 'gray' as BadgeTone };
  const memberRows = (memberships ?? []) as unknown as MembershipRow[];
  const emailById = new Map(authUsers.users.map((u) => [u.id, u.email]));
  const lastLoginById = new Map(authUsers.users.map((u) => [u.id, u.lastSignInAt]));
  const disabledFeatureKeys = (flags ?? []).filter((f) => !f.enabled).map((f) => f.flag_key);

  const onboarding = (org.onboarding ?? {}) as { step?: number; completed?: boolean };
  const billing = (org.billing_info ?? {}) as { name?: string; email?: string; note?: string };

  const currentPlan = (plans ?? []).find((p) => p.code === org.plan_code);
  const planFeatures = (currentPlan?.features ?? {}) as { store_limit?: number | null; user_limit?: number | null };
  const storeCount = (stores ?? []).length;
  const storeLimit = planFeatures.store_limit ?? null;
  const userLimit = planFeatures.user_limit ?? null;
  const storeOverLimit = storeLimit != null && storeCount > storeLimit;
  const userOverLimit = userLimit != null && (activeUserCount ?? 0) > userLimit;

  const subscriptionInitial = {
    status: (subscription?.status ?? 'inactive') as SaasSubscriptionStatus,
    planCode: subscription?.plan_code ?? org.plan_code,
    currentPeriodStart: subscription?.current_period_start ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
  };
  const subscriptionStatusMeta = SUBSCRIPTION_STATUS_LABEL[subscriptionInitial.status];

  return (
    <div>
      <Link href="/admin/organizations" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ArrowLeft className="h-3.5 w-3.5" />
        契約企業一覧へ戻る
      </Link>

      <PageHeader
        title={org.name}
        description={org.name_kana ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {org.is_demo && <Badge tone="navy">デモ</Badge>}
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>概要</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-gray-500">連絡先メール</p>
                <p className="text-navy">{org.contact_email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">連絡先電話</p>
                <p className="text-navy">{org.contact_phone ?? org.phone ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">プラン</p>
                <p className="text-navy">{planNameByCode.get(org.plan_code) ?? org.plan_code}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-gray-500">住所</p>
                <p className="text-navy">
                  {org.postal_code ? `〒${org.postal_code} ` : ''}
                  {org.address ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">契約開始日</p>
                <p className="text-navy">{formatDate(org.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">オンボーディング進捗</p>
                <p className="text-navy">
                  {onboarding.completed ? (
                    <Badge tone="success">完了</Badge>
                  ) : (
                    <Badge tone="warning">{`未完了（ステップ ${onboarding.step ?? 1}/10）`}</Badge>
                  )}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-gray-500">請求先情報</p>
                <p className="text-navy">
                  {billing.name || billing.email
                    ? `${billing.name ?? ''}${billing.name && billing.email ? ' / ' : ''}${billing.email ?? ''}`
                    : '未設定'}
                </p>
                {billing.note && <p className="mt-0.5 text-xs text-gray-500">{billing.note}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>店舗一覧</CardTitle>
              <CreateStoreDialog organizationId={org.id} />
            </CardHeader>
            <CardContent className="p-0">
              {(stores ?? []).length === 0 ? (
                <EmptyState className="border-0" title="店舗がまだありません" description="「店舗を追加」から最初の店舗を登録してください" />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>店舗名</Th>
                        <Th>状態</Th>
                        <Th>オンライン予約</Th>
                        <Th>作成日</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {(stores ?? []).map((s) => {
                        const meta = STORE_STATUS_LABEL[s.status] ?? { label: s.status, tone: 'gray' as BadgeTone };
                        return (
                          <Tr key={s.id}>
                            <Td>
                              <p className="font-medium text-navy">{s.name}</p>
                              <p className="text-xs text-gray-400">/{s.slug}</p>
                            </Td>
                            <Td>
                              <Badge tone={meta.tone}>{meta.label}</Badge>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>メンバー一覧</CardTitle>
              <AddOrgMemberDialog organizationId={org.id} />
            </CardHeader>
            <CardContent className="p-0">
              {memberRows.length === 0 ? (
                <EmptyState className="border-0" title="メンバーがまだいません" description="「ユーザーを追加」から最初のメンバーを登録してください" />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>氏名</Th>
                        <Th>メールアドレス</Th>
                        <Th>ロール</Th>
                        <Th>状態</Th>
                        <Th>最終ログイン</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {memberRows.map((m) => {
                        const profile = one(m.profiles);
                        return (
                          <Tr key={m.id}>
                            <Td className="font-medium text-navy">{profile?.display_name ?? '—'}</Td>
                            <Td className="font-mono text-xs">{emailById.get(m.profile_id) ?? '—'}</Td>
                            <Td>{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}</Td>
                            <Td>
                              <Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'primary' : 'warning'}>
                                {m.status === 'active' ? '有効' : m.status === 'invited' ? '招待中' : '停止中'}
                              </Badge>
                            </Td>
                            <Td className="text-xs text-gray-500">{formatDateTime(lastLoginById.get(m.profile_id) ?? null)}</Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>契約操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs text-gray-500">プラン</p>
                <OrgPlanForm organizationId={org.id} currentPlanCode={org.plan_code} plans={plans ?? []} />
                {(storeLimit != null || userLimit != null) && (
                  <div className="mt-2 space-y-1 text-xs text-gray-500">
                    <p className="flex items-center gap-1.5">
                      店舗数: {storeCount}
                      {storeLimit != null ? ` / 上限${storeLimit}` : '（上限なし）'}
                      {storeOverLimit && (
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          上限超過
                        </Badge>
                      )}
                    </p>
                    <p className="flex items-center gap-1.5">
                      ユーザー数: {activeUserCount ?? 0}
                      {userLimit != null ? ` / 上限${userLimit}` : '（上限なし）'}
                      {userOverLimit && (
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          上限超過
                        </Badge>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400">上限超過時の制御はプラン運用ポリシー確定後に実装します（現時点ではハードブロックしません）。</p>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs text-gray-500">契約状態</p>
                <OrganizationRowActions organizationId={org.id} status={org.status} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>利用量メータリング（今月）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-lg bg-surface px-3 py-3">
                  <p className="text-xl font-bold text-navy tabular-nums">{storeCount}</p>
                  <p className="mt-1 text-[11px] text-gray-500">店舗数</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-3">
                  <p className="text-xl font-bold text-navy tabular-nums">{activeUserCount ?? 0}</p>
                  <p className="mt-1 text-[11px] text-gray-500">ユーザー数</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-3">
                  <p className="text-xl font-bold text-navy tabular-nums">{monthReservationsCount ?? 0}</p>
                  <p className="mt-1 text-[11px] text-gray-500">今月の予約数</p>
                </div>
                <div className="rounded-lg bg-surface px-3 py-3">
                  <p className="text-xl font-bold text-navy tabular-nums">{monthOrdersCount ?? 0}</p>
                  <p className="mt-1 text-[11px] text-gray-500">今月の注文数</p>
                </div>
                <div className="col-span-2 rounded-lg bg-surface px-3 py-3">
                  <p className="text-xl font-bold text-navy tabular-nums">
                    {documentsCount ?? 0}件 / {formatBytes(totalStorageBytes)}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">書類ストレージ（documents）</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-gray-400">
                将来の課金計算の基礎データです。外部送信はしません。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>サブスクリプション</CardTitle>
              <Badge tone={subscriptionStatusMeta.tone}>{subscriptionStatusMeta.label}</Badge>
            </CardHeader>
            <CardContent>
              <SubscriptionMockForm organizationId={org.id} plans={plans ?? []} initial={subscriptionInitial} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>機能フラグ</CardTitle>
              <ApplyPlanDefaultsButton organizationId={org.id} />
            </CardHeader>
            <CardContent>
              <FeatureFlagMatrix organizationId={org.id} disabledKeys={disabledFeatureKeys} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
