import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeProgress, evaluateGoLive, ENVIRONMENT_LABELS, STAGE_LABELS, MODULE_LABELS, MODULES, type Environment, type Stage, type ChecklistState } from '@/lib/tenant-onboarding';
import { computeStoreSignals } from '../signals';
import { listAllAuthUsers } from '../../_utils';
import { TenantControls } from '@/components/admin/tenant-controls';
import { TenantChecklist } from '@/components/admin/tenant-checklist';
import { TenantAccounts } from '@/components/admin/tenant-accounts';
import { TenantHardware } from '@/components/admin/tenant-hardware';
import { TenantSupportNotes } from '@/components/admin/tenant-support-notes';

export const metadata: Metadata = { title: '店舗導入管理' };

const ENV_TONE: Record<Environment, BadgeTone> = { demo: 'gray', test: 'primary', pilot: 'warning', production: 'success' };
const STAGE_TONE: Record<Stage, BadgeTone> = {
  draft: 'gray', onboarding: 'primary', configuration: 'primary', testing: 'warning',
  pilot: 'warning', ready: 'success', live: 'success', suspended: 'danger', cancelled: 'gray',
};

export default async function TenantDetailPage({ params }: { params: Promise<{ storeId: string }> }) {
  await requireCypressAdmin();
  const { storeId } = await params;
  const admin = createAdminClient();

  const { data: onboarding } = await admin.from('store_onboarding').select('*').eq('store_id', storeId).maybeSingle();
  const { data: store } = await admin
    .from('stores')
    .select('id, name, slug, status, seat_count, booking_enabled, organization_id, address, phone, email, organizations(name, plan_code, status, is_demo)')
    .eq('id', storeId)
    .maybeSingle();
  if (!onboarding || !store) notFound();

  const org = store.organizations as unknown as { name: string; plan_code: string; status: string; is_demo: boolean } | null;
  const enabledModules = onboarding.enabled_modules ?? [];
  const checklist = (onboarding.checklist as ChecklistState) ?? {};

  const [signals, membersRes, hardwareRes, notesRes, flagsRes, auditRes, authUsers, orgStoresRes] = await Promise.all([
    computeStoreSignals(admin, store),
    admin.from('memberships').select('id, role, status, profile_id, profiles(display_name, has_pin), membership_stores(store_id, stores(name))').eq('organization_id', store.organization_id).order('created_at'),
    admin.from('store_hardware').select('*').eq('store_id', storeId).order('created_at'),
    admin.from('tenant_support_notes').select('*').or(`store_id.eq.${storeId},and(organization_id.eq.${store.organization_id},store_id.is.null)`).order('created_at', { ascending: false }).limit(50),
    admin.from('feature_flags').select('flag_key, enabled, organization_id').or(`organization_id.eq.${store.organization_id},organization_id.is.null`),
    admin.from('audit_logs').select('id, action, actor_role, created_at, note').eq('store_id', storeId).order('created_at', { ascending: false }).limit(10),
    listAllAuthUsers(admin, { maxPages: 10 }),
    admin.from('stores').select('id, name').eq('organization_id', store.organization_id).eq('status', 'active').order('name'),
  ]);
  const orgStores = (orgStoresRes.data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }));

  const progress = computeProgress(signals, checklist, enabledModules);
  const goLive = evaluateGoLive(signals, checklist, enabledModules);

  const emailById = new Map(authUsers.users.map((u) => [u.id, { email: u.email, lastSignInAt: u.lastSignInAt }]));
  const members = (membersRes.data ?? []).map((m) => {
    const p = m.profiles as unknown as { display_name: string; has_pin: boolean | null } | null;
    const auth = emailById.get(m.profile_id);
    const ms = (m.membership_stores as unknown as { store_id: string; stores: { name: string } | null }[] | null) ?? [];
    return {
      membershipId: m.id as string,
      profileId: m.profile_id as string,
      displayName: p?.display_name ?? '—',
      role: m.role as string,
      status: m.status as string,
      email: auth?.email ?? null,
      lastSignInAt: auth?.lastSignInAt ?? null,
      storeIds: ms.map((x) => x.store_id),
      storeNames: ms.map((x) => x.stores?.name).filter((n): n is string => !!n),
    };
  });

  // 機能フラグ（org単位・default ON・org指定がglobalより優先）を module 表示へ
  const flagRows = (flagsRes.data ?? []) as { flag_key: string; enabled: boolean; organization_id: string | null }[];
  const orgFlag = new Map<string, boolean>();
  const globalFlag = new Map<string, boolean>();
  for (const f of flagRows) {
    if (f.organization_id === store.organization_id) orgFlag.set(f.flag_key, f.enabled);
    else if (f.organization_id == null) globalFlag.set(f.flag_key, f.enabled);
  }
  const moduleEnabled = (key: string) => (orgFlag.has(key) ? orgFlag.get(key)! : globalFlag.has(key) ? globalFlag.get(key)! : true);

  const hardware = (hardwareRes.data ?? []).map((h) => ({
    id: h.id as string, category: h.category as string, provider: h.provider as string | null,
    model: h.model as string | null, connection: h.connection as string | null,
    ipAddress: h.ip_address as string | null, status: h.status as string, note: h.note as string | null,
  }));
  const notes = (notesRes.data ?? []).map((n) => ({
    id: n.id as string, body: n.body as string, authorId: n.author_id as string | null,
    createdAt: n.created_at as string, authorName: n.author_id ? (emailById.get(n.author_id)?.email ?? '—') : '—',
  }));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const bookingUrl = siteUrl && store.slug ? `${siteUrl}/book/${store.slug}` : null;

  return (
    <div className="space-y-5">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ChevronLeft className="h-4 w-4" />導入店舗一覧へ戻る
      </Link>
      <PageHeader
        title={store.name}
        description={`${org?.name ?? ''}｜プラン: ${org?.plan_code ?? '—'}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={ENV_TONE[onboarding.environment as Environment]}>{ENVIRONMENT_LABELS[onboarding.environment as Environment]}</Badge>
            <Badge tone={STAGE_TONE[onboarding.stage as Stage]}>{STAGE_LABELS[onboarding.stage as Stage]}</Badge>
            {onboarding.environment === 'pilot' && <Badge tone="warning">パイロット運用中</Badge>}
          </div>
        }
      />

      {/* 基本情報 + 未設定表示 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>基本情報</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <InfoRow label="会社" value={org?.name} />
            <InfoRow label="店舗" value={store.name} />
            <InfoRow label="slug" value={store.slug} mono />
            <InfoRow label="住所" value={store.address} />
            <InfoRow label="電話" value={store.phone} />
            <InfoRow label="店舗状態" value={store.status} />
            <InfoRow label="オンライン予約" value={store.booking_enabled ? '受付中' : '停止'} />
            <InfoRow label="利用開始日" value={onboarding.opened_on ? formatDate(onboarding.opened_on) : null} />
            <InfoRow label="Go Live" value={onboarding.go_live_at ? formatDateTime(onboarding.go_live_at) : null} />
            {bookingUrl && (
              <div className="pt-1">
                <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" />公開予約ページ
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 環境・ステージ・モジュール制御 */}
        <TenantControls
          storeId={storeId}
          stage={onboarding.stage as Stage}
          environment={onboarding.environment as Environment}
          enabledModules={enabledModules}
        />
      </div>

      {/* Go Live 判定 + 進捗 + チェックリスト */}
      <TenantChecklist
        storeId={storeId}
        signals={signals}
        checklist={checklist}
        enabledModules={enabledModules}
        progress={progress}
        goLive={goLive}
        stage={onboarding.stage as Stage}
      />

      {/* 機能フラグ（org単位・default ON）表示 */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>機能フラグ（会社単位）</CardTitle>
          <Link href="/admin/feature-flags" className="text-xs font-medium text-primary hover:underline">機能フラグ管理へ</Link>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {MODULES.map((m) => {
              const on = moduleEnabled(m);
              return (
                <span key={m} className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${on ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                  {MODULE_LABELS[m]}：{on ? 'ON' : 'OFF'}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">機能フラグの変更はCYPRESS運営のみ（機能フラグ管理画面）。この店舗の「利用モジュール」設定とは別に、UIの表示可否を制御します。</p>
        </CardContent>
      </Card>

      {/* アカウント */}
      <TenantAccounts storeId={storeId} members={members} orgStores={orgStores} />

      {/* ハードウェア */}
      <TenantHardware storeId={storeId} hardware={hardware} />

      {/* サポートメモ */}
      <TenantSupportNotes storeId={storeId} notes={notes} />

      {/* 導入履歴（監査） */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>導入履歴（監査ログ）</CardTitle>
          <Link href="/admin/audit-logs" className="text-xs font-medium text-primary hover:underline">監査ログ全体へ</Link>
        </CardHeader>
        <CardContent>
          {auditRes.data && auditRes.data.length > 0 ? (
            <ul className="divide-y divide-gray-100 text-sm">
              {auditRes.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span className="font-mono text-xs text-navy">{a.action}</span>
                  <span className="text-xs text-gray-500">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">この店舗の履歴はまだありません。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      {value ? (
        <span className={mono ? 'font-mono text-navy' : 'text-navy'}>{value}</span>
      ) : (
        <span className="text-xs font-medium text-amber-600">未設定</span>
      )}
    </div>
  );
}
