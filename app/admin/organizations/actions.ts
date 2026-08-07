'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ROLES } from '@/lib/permissions';
import { FEATURE_KEYS } from '@/lib/features';

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export interface CreateOrganizationInput {
  name: string;
  nameKana?: string;
  planCode: string;
  ownerEmail: string;
  ownerName: string;
}

export interface CreateOrganizationResult {
  organizationId: string;
  email: string;
  password: string;
}

/** 契約企業を新規作成し、オーナーアカウントを発行する */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<CreateOrganizationResult> {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim();
  const ownerName = input.ownerName.trim();
  if (!name) throw new Error('企業名を入力してください');
  if (!ownerEmail) throw new Error('オーナーのメールアドレスを入力してください');
  if (!ownerName) throw new Error('オーナーの氏名を入力してください');

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name,
      name_kana: input.nameKana?.trim() || null,
      plan_code: input.planCode,
      status: 'active',
    })
    .select('id')
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? '企業の作成に失敗しました');

  const password = randomPassword();
  const { data: userRes, error: userError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
    user_metadata: { display_name: ownerName },
  });
  if (userError || !userRes.user) {
    // ロールバック: 作成済みの企業を削除
    await admin.from('organizations').delete().eq('id', org.id);
    throw new Error(userError?.message ?? 'オーナーアカウントの作成に失敗しました');
  }

  const { error: membershipError } = await admin.from('memberships').insert({
    organization_id: org.id,
    profile_id: userRes.user.id,
    role: 'org_owner',
    status: 'active',
  });
  if (membershipError) throw new Error(membershipError.message);

  // 監査ログはセッションクライアントで呼び出す（service roleにはauth.uid()が無いため）
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: org.id,
    p_store: null,
    p_action: 'organization.create',
    p_target_table: 'organizations',
    p_target_id: org.id,
    p_before: null,
    p_after: { name, plan_code: input.planCode, owner_email: ownerEmail },
    p_note: null,
  });

  revalidatePath('/admin/organizations');
  return { organizationId: org.id, email: ownerEmail, password };
}

/** 企業の利用停止（監査ログに理由を記録） */
export async function suspendOrganization(organizationId: string, reason: string) {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: before } = await admin
    .from('organizations')
    .select('status')
    .eq('id', organizationId)
    .single();

  const { error } = await admin
    .from('organizations')
    .update({ status: 'suspended' })
    .eq('id', organizationId);
  if (error) throw new Error(error.message);

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'organization.suspend',
    p_target_table: 'organizations',
    p_target_id: organizationId,
    p_before: before ?? null,
    p_after: { status: 'suspended' },
    p_note: reason || null,
  });

  revalidatePath('/admin/organizations');
}

/** 企業の利用再開（監査ログに記録） */
export async function reactivateOrganization(organizationId: string, reason: string) {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: before } = await admin
    .from('organizations')
    .select('status')
    .eq('id', organizationId)
    .single();

  const { error } = await admin
    .from('organizations')
    .update({ status: 'active' })
    .eq('id', organizationId);
  if (error) throw new Error(error.message);

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'organization.reactivate',
    p_target_table: 'organizations',
    p_target_id: organizationId,
    p_before: before ?? null,
    p_after: { status: 'active' },
    p_note: reason || null,
  });

  revalidatePath('/admin/organizations');
}

// =============================================================
// 企業詳細ページ（/admin/organizations/[id]）用アクション
// =============================================================

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `store-${Date.now().toString(36)}`;
}

export interface CreateStoreForOrgInput {
  organizationId: string;
  name: string;
  address?: string;
}

export interface CreateStoreForOrgResult {
  storeId: string;
  slug: string;
}

/** 企業詳細から店舗を追加（stores + store_settings）。slugは名称から自動生成し重複時はサフィックスを付与する */
export async function createStoreForOrg(input: CreateStoreForOrgInput): Promise<CreateStoreForOrgResult> {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const name = input.name.trim();
  if (!name) throw new Error('店舗名を入力してください');

  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt <= 5; attempt++) {
    if (attempt > 0) slug = `${base}-${attempt}`;
    const { data: store, error } = await admin
      .from('stores')
      .insert({
        organization_id: input.organizationId,
        slug,
        name,
        address: input.address?.trim() || null,
      })
      .select('id, slug')
      .single();

    if (!error && store) {
      const { error: settingsErr } = await admin
        .from('store_settings')
        .insert({ organization_id: input.organizationId, store_id: store.id });
      if (settingsErr) throw new Error(`店舗設定の作成に失敗しました: ${settingsErr.message}`);

      const supabase = await createClient();
      await supabase.rpc('log_audit', {
        p_org: input.organizationId,
        p_store: store.id,
        p_action: 'store.create',
        p_target_table: 'stores',
        p_target_id: store.id,
        p_before: null,
        p_after: { name, slug: store.slug },
        p_note: null,
      });

      revalidatePath(`/admin/organizations/${input.organizationId}`);
      return { storeId: store.id, slug: store.slug };
    }

    if (error?.code !== '23505') {
      throw new Error(error?.message ?? '店舗の作成に失敗しました');
    }
    // slug重複: 次のループでサフィックスを付けて再試行
  }
  throw new Error('店舗の作成に失敗しました（slugの重複を解消できませんでした）');
}

export interface AddOrgMemberInput {
  organizationId: string;
  email: string;
  displayName: string;
  role: string;
}

export interface AddOrgMemberResult {
  membershipId: string;
  email: string;
  password: string;
}

/** 企業詳細からメンバーを追加（auth.users作成→memberships作成）。初期パスワードは自動生成 */
export async function addOrgMember(input: AddOrgMemberInput): Promise<AddOrgMemberResult> {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('メールアドレスの形式が正しくありません');
  }
  if (!displayName) throw new Error('氏名を入力してください');
  if (!(ROLES as readonly string[]).includes(input.role)) throw new Error('不正なロールです');

  const password = randomPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? '';
    if (/already|registered|exists/i.test(msg)) throw new Error('このメールアドレスは既に登録されています');
    throw new Error(`ユーザー作成に失敗しました: ${msg || '不明なエラー'}`);
  }

  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .insert({ organization_id: input.organizationId, profile_id: created.user.id, role: input.role, status: 'active' })
    .select('id')
    .single();
  if (memErr || !membership) throw new Error(memErr?.message ?? 'メンバー登録に失敗しました');

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: input.organizationId,
    p_store: null,
    p_action: 'organization.member_add',
    p_target_table: 'memberships',
    p_target_id: membership.id as string,
    p_before: null,
    p_after: { role: input.role, email },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${input.organizationId}`);
  return { membershipId: membership.id as string, email, password };
}

/** プラン変更（監査ログに記録） */
export async function changeOrgPlan(organizationId: string, planCode: string) {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: plan } = await admin.from('plans').select('code').eq('code', planCode).eq('is_active', true).maybeSingle();
  if (!plan) throw new Error('不正なプランです');

  const { data: before } = await admin.from('organizations').select('plan_code').eq('id', organizationId).single();

  const { error } = await admin.from('organizations').update({ plan_code: planCode }).eq('id', organizationId);
  if (error) throw new Error(error.message);

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'organization.plan_change',
    p_target_table: 'organizations',
    p_target_id: organizationId,
    p_before: before ?? null,
    p_after: { plan_code: planCode },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath('/admin/organizations');
}

/**
 * 企業単位の機能フラグ切替（feature_flags規約: 行なし=有効・enabled=falseの行のみ無効）。
 * ON: 既存行があれば削除して既定（有効）に戻す。OFF: enabled=falseで upsert。
 */
export async function setOrgFeatureFlag(organizationId: string, flagKey: string, enabled: boolean) {
  await requireCypressAdmin();
  if (!(FEATURE_KEYS as readonly string[]).includes(flagKey)) throw new Error('不正な機能キーです');

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('feature_flags')
    .select('id, enabled')
    .eq('organization_id', organizationId)
    .eq('flag_key', flagKey)
    .maybeSingle();

  if (enabled) {
    if (existing) {
      const { error } = await admin.from('feature_flags').delete().eq('id', existing.id);
      if (error) throw new Error(error.message);
    }
  } else if (existing) {
    const { error } = await admin.from('feature_flags').update({ enabled: false }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from('feature_flags')
      .insert({ organization_id: organizationId, flag_key: flagKey, enabled: false });
    if (error) throw new Error(error.message);
  }

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'feature_flag.org_toggle',
    p_target_table: 'feature_flags',
    p_target_id: flagKey,
    p_before: { enabled: existing ? existing.enabled : true },
    p_after: { enabled },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
}

// =============================================================
// SaaS課金（Stripe Billing接続前のモック管理。実課金は発生しない）
// =============================================================

const SUBSCRIPTION_STATUSES = ['inactive', 'trialing', 'active', 'past_due', 'canceled'] as const;
export type SaasSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionMockInput {
  status: SaasSubscriptionStatus;
  planCode: string;
  currentPeriodStart: string | null; // 'YYYY-MM-DD'
  currentPeriodEnd: string | null; // 'YYYY-MM-DD'
}

/** saas_subscriptions の手動更新（Stripe Billing接続前のモック管理）。実課金は発生しない */
export async function updateOrgSubscriptionMock(organizationId: string, input: SubscriptionMockInput) {
  await requireCypressAdmin();
  if (!(SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error('不正な状態です');
  }
  const admin = createAdminClient();

  const { data: plan } = await admin.from('plans').select('code').eq('code', input.planCode).maybeSingle();
  if (!plan) throw new Error('不正なプランです');

  const { data: before } = await admin
    .from('saas_subscriptions')
    .select('status, plan_code, current_period_start, current_period_end')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const payload = {
    organization_id: organizationId,
    provider: 'stripe',
    plan_code: input.planCode,
    status: input.status,
    current_period_start: input.currentPeriodStart ? new Date(`${input.currentPeriodStart}T00:00:00+09:00`).toISOString() : null,
    current_period_end: input.currentPeriodEnd ? new Date(`${input.currentPeriodEnd}T00:00:00+09:00`).toISOString() : null,
  };

  const { error } = await admin.from('saas_subscriptions').upsert(payload, { onConflict: 'organization_id' });
  if (error) throw new Error(error.message);

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'organization.subscription_mock_update',
    p_target_table: 'saas_subscriptions',
    p_target_id: organizationId,
    p_before: before ?? null,
    p_after: payload,
    p_note: 'Stripe Billing接続前のモック管理です（実課金は発生しません）',
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
}

// =============================================================
// プラン既定値の企業への適用（機能フラグ初期化）
// =============================================================

interface PlanFeaturesShape {
  storeLimit?: number | null;
  userLimit?: number | null;
  features?: Partial<Record<string, boolean>>;
}

/**
 * プランの features.features でfalseになっている機能を、企業のfeature_flagsへ反映する。
 * true側（有効）は既存の企業別設定を尊重し変更しない。
 */
export async function applyPlanDefaultsToOrg(organizationId: string): Promise<{ disabledKeys: string[] }> {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: org } = await admin.from('organizations').select('plan_code').eq('id', organizationId).single();
  if (!org) throw new Error('企業が見つかりません');

  const { data: plan } = await admin.from('plans').select('code, features').eq('code', org.plan_code).maybeSingle();
  if (!plan) throw new Error('プランが見つかりません');

  const planFeatures = (plan.features ?? {}) as PlanFeaturesShape;
  const defaults = planFeatures.features ?? {};
  const disabledKeys = (FEATURE_KEYS as readonly string[]).filter((k) => defaults[k] === false);

  for (const key of disabledKeys) {
    const { data: existing } = await admin
      .from('feature_flags')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('flag_key', key)
      .maybeSingle();
    if (existing) {
      await admin.from('feature_flags').update({ enabled: false }).eq('id', existing.id);
    } else {
      await admin.from('feature_flags').insert({ organization_id: organizationId, flag_key: key, enabled: false });
    }
  }

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'organization.apply_plan_defaults',
    p_target_table: 'feature_flags',
    p_target_id: organizationId,
    p_before: null,
    p_after: { plan_code: org.plan_code, disabled_keys: disabledKeys },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  return { disabledKeys };
}
