'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { STORE_COOKIE, getSessionContext, requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SUPPORT_MEMBERSHIP_NOTE, SUPPORT_ORG_COOKIE } from '@/lib/support-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 12 };

/** 運営の自分のサポート用メンバーシップを全部外す（他の会社に入ったまま にしない） */
async function clearSupportMemberships(profileId: string, exceptOrg?: string) {
  const admin = createAdminClient();
  let q = admin.from('memberships').delete().eq('profile_id', profileId).eq('hourly_note', SUPPORT_MEMBERSHIP_NOTE);
  if (exceptOrg) q = q.neq('organization_id', exceptOrg);
  const { error } = await q;
  if (error) {
    // 消せない（他の表から参照されている等）ときは止めておく
    let u = admin.from('memberships').update({ status: 'suspended' }).eq('profile_id', profileId).eq('hourly_note', SUPPORT_MEMBERSHIP_NOTE);
    if (exceptOrg) u = u.neq('organization_id', exceptOrg);
    await u;
  }
}

/**
 * コントロールセンターの「当店舗の管理画面へ」（2026-10-26 Ronnie）。storeId が 'org:<企業id>' なら全店舗で入る。
 * 運営だけ。入る前に監査ログ（support_access）に残す。lib/support-access.ts
 */
export async function enterStoreAdmin(formData: FormData): Promise<void> {
  const ctx = await requireCypressAdmin();
  const target = String(formData.get('target') ?? '');
  const admin = createAdminClient();

  let organizationId: string;
  let storeId: string | null = null;
  let label: string;
  if (target.startsWith('org:')) {
    organizationId = target.slice(4);
    if (!UUID.test(organizationId)) throw new Error('企業が見つかりません');
    const { data: org } = await admin.from('organizations').select('id, name').eq('id', organizationId).maybeSingle();
    if (!org) throw new Error('企業が見つかりません');
    label = `${org.name}（全店舗）`;
  } else {
    if (!UUID.test(target)) throw new Error('店舗が見つかりません');
    const { data: store } = await admin.from('stores').select('id, name, organization_id, organizations(name)').eq('id', target).maybeSingle();
    if (!store) throw new Error('店舗が見つかりません');
    organizationId = store.organization_id as string;
    storeId = store.id as string;
    const orgName = (store.organizations as unknown as { name?: string } | null)?.name ?? '';
    label = `${orgName} ${store.name}`;
  }

  // 本当のメンバー（印のないメンバーシップ）があればそのまま使い、印のついた行は作らない
  const { data: existing } = await admin
    .from('memberships')
    .select('id, hourly_note, status')
    .eq('organization_id', organizationId)
    .eq('profile_id', ctx.userId)
    .maybeSingle();
  if (!existing) {
    const { error } = await admin.from('memberships').insert({
      organization_id: organizationId,
      profile_id: ctx.userId,
      role: 'org_owner',
      status: 'active',
      hourly_note: SUPPORT_MEMBERSHIP_NOTE,
      created_by: ctx.userId,
    });
    if (error) throw new Error(`入れませんでした: ${error.message}`);
  } else if (existing.hourly_note === SUPPORT_MEMBERSHIP_NOTE && existing.status !== 'active') {
    await admin.from('memberships').update({ status: 'active', role: 'org_owner' }).eq('id', existing.id);
  }
  await clearSupportMemberships(ctx.userId, organizationId);

  // 監査ログ（入った運営のユーザーで記録）
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: storeId,
    p_action: 'support_access',
    p_target_table: storeId ? 'stores' : 'organizations',
    p_target_id: storeId ?? organizationId,
    p_before: null,
    p_after: null,
    p_note: `コントロールセンターから管理画面へ：${label}`,
  });

  const jar = await cookies();
  jar.set(SUPPORT_ORG_COOKIE, organizationId, COOKIE);
  jar.set(STORE_COOKIE, storeId ?? 'all', { ...COOKIE, maxAge: 60 * 60 * 24 * 365 });
  redirect('/app/dashboard');
}

/** 管理画面の上の「コントロールセンターに戻る」。サポート用のメンバーシップを外して戻る */
export async function exitStoreAdmin(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.isCypressAdmin) redirect('/app/dashboard');
  await clearSupportMemberships(ctx.userId);
  const jar = await cookies();
  jar.delete(SUPPORT_ORG_COOKIE);
  jar.delete(STORE_COOKIE);
  redirect('/admin/stores');
}
