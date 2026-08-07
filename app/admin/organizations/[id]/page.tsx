import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate, formatDateTime } from '@/lib/format';
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
import { listAllAuthUsers } from '../../_utils';

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
      admin.from('plans').select('code, name').eq('is_active', true).order('sort_order'),
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

  const planNameByCode = new Map((plans ?? []).map((p) => [p.code, p.name]));
  const statusMeta = STATUS_LABEL[org.status] ?? { label: org.status, tone: 'gray' as BadgeTone };
  const memberRows = (memberships ?? []) as unknown as MembershipRow[];
  const emailById = new Map(authUsers.users.map((u) => [u.id, u.email]));
  const lastLoginById = new Map(authUsers.users.map((u) => [u.id, u.lastSignInAt]));
  const disabledFeatureKeys = (flags ?? []).filter((f) => !f.enabled).map((f) => f.flag_key);

  const onboarding = (org.onboarding ?? {}) as { step?: number; completed?: boolean };
  const billing = (org.billing_info ?? {}) as { name?: string; email?: string; note?: string };

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
              </div>
              <div>
                <p className="mb-1.5 text-xs text-gray-500">契約状態</p>
                <OrganizationRowActions organizationId={org.id} status={org.status} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>機能フラグ</CardTitle>
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
