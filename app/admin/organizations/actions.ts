'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ROLES } from '@/lib/permissions';
import { FEATURE_KEYS } from '@/lib/features';
import { withErrorCapture } from '@/lib/observability-server';
import { assignOrgCode, assignStoreUsername, setupStoreContract } from '@/lib/tenant-provisioning';
import { STORE_SETTINGS_COLUMNS_TO_COPY, cloneRow, copyMenuSettings } from '@/lib/store-menu-copy';

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
  // レジ（iPad）のログインで使う企業番号（6桁の数字）
  await assignOrgCode(admin, org.id as string);

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
// テナントoffboarding（データ保護）
// 状態遷移: active/trial ↔ suspended → cancelled → pending_deletion
// cancelled / pending_deletion のいずれも物理削除は行わない。データの実削除は
// 別途の運用手順（保持期限経過後にCYPRESS運営が個別に実施）に従う。本操作はステータス変更のみ。
// =============================================================

/** 契約解約（active/trial/suspendedのいずれからも遷移可）。物理削除は行わない。 */
export async function cancelOrganization(organizationId: string, reason: string) {
  const ctx = await requireCypressAdmin();
  if (!reason.trim()) throw new Error('解約理由を入力してください');
  const admin = createAdminClient();

  const { data: before } = await admin.from('organizations').select('status').eq('id', organizationId).single();
  if (!before) throw new Error('企業が見つかりません');
  if (before.status === 'cancelled' || before.status === 'pending_deletion') {
    throw new Error('既に解約済みです');
  }

  await withErrorCapture(
    { route: 'admin.organizations.cancel', organizationId, userId: ctx.userId },
    async () => {
      const { error } = await admin.from('organizations').update({ status: 'cancelled' }).eq('id', organizationId);
      if (error) throw new Error(error.message);

      const supabase = await createClient();
      await supabase.rpc('log_audit', {
        p_org: organizationId,
        p_store: null,
        p_action: 'organization.cancel',
        p_target_table: 'organizations',
        p_target_id: organizationId,
        p_before: before,
        p_after: { status: 'cancelled' },
        p_note: reason.trim(),
      });
    }
  );

  revalidatePath('/admin/organizations');
  revalidatePath(`/admin/organizations/${organizationId}`);
}

/**
 * 解約済み企業を「削除待ち」へ遷移する（cancelledからのみ）。
 * データの物理削除はこの操作では行わない。保持期限経過後の実削除は別途の運用手順に従う。
 */
export async function markOrganizationPendingDeletion(organizationId: string, reason: string) {
  const ctx = await requireCypressAdmin();
  if (!reason.trim()) throw new Error('理由を入力してください');
  const admin = createAdminClient();

  const { data: before } = await admin.from('organizations').select('status').eq('id', organizationId).single();
  if (!before) throw new Error('企業が見つかりません');
  if (before.status !== 'cancelled') throw new Error('解約済みの企業のみ削除待ちに遷移できます');

  await withErrorCapture(
    { route: 'admin.organizations.mark_pending_deletion', organizationId, userId: ctx.userId },
    async () => {
      const { error } = await admin
        .from('organizations')
        .update({ status: 'pending_deletion' })
        .eq('id', organizationId);
      if (error) throw new Error(error.message);

      const supabase = await createClient();
      await supabase.rpc('log_audit', {
        p_org: organizationId,
        p_store: null,
        p_action: 'organization.mark_pending_deletion',
        p_target_table: 'organizations',
        p_target_id: organizationId,
        p_before: before,
        p_after: { status: 'pending_deletion' },
        p_note: reason.trim(),
      });
    }
  );

  revalidatePath('/admin/organizations');
  revalidatePath(`/admin/organizations/${organizationId}`);
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
  /** 契約: お店の回線（グローバルIP）。1件でも入れるとレジ・ハンディが制限される */
  storeIps?: { ip: string; label: string }[];
  /** 契約: レジ（iPad）の台数（既定2台） */
  registerLimit?: number;
  /** 契約: ハンディの台数（既定2台） */
  handyLimit?: number;
  /** レジのログインで打つ店舗ユーザー名（未指定なら店舗名から作る） */
  storeUser?: string;
}

export interface CreateStoreForOrgResult {
  storeId: string;
  slug: string;
  /** レジ（iPad）のログインで使う（一度だけ表示） */
  orgCode?: string;
  storeUser?: string;
  registerPassword?: string;
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

      const storeUser = await assignStoreUsername(admin, {
        organizationId: input.organizationId,
        storeId: store.id,
        desired: input.storeUser,
        seed: store.slug ?? name,
      });

      // 契約の内容（お店の回線・レジ台数・ハンディ台数・レジ用パスワード）
      const contract = await setupStoreContract(admin, {
        organizationId: input.organizationId,
        storeId: store.id,
        ips: input.storeIps ?? [],
        registerLimit: input.registerLimit,
        handyLimit: input.handyLimit,
      });
      const { data: orgRow } = await admin
        .from('organizations')
        .select('org_code')
        .eq('id', input.organizationId)
        .maybeSingle();

      revalidatePath(`/admin/organizations/${input.organizationId}`);
      return {
        storeId: store.id,
        slug: store.slug,
        orgCode: (orgRow?.org_code as string | null) ?? undefined,
        storeUser: storeUser ?? undefined,
        registerPassword: contract.registerPassword,
      };
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

// =============================================================
// 店舗のメニューを別の店舗にコピー（2026-10-14 Ronnie「FULLMOoN 五反田を追加。メニューとレジの設定は肉ギャング渋谷と同じ」）
// =============================================================

export interface CopyStoreMenuInput {
  organizationId: string;
  sourceStoreId: string;
  targetStoreId: string;
}

export interface CopyStoreMenuResult {
  categories: number;
  items: number;
  variants: number;
  optionGroups: number;
  optionItems: number;
  itemOptionLinks: number;
  modifierLinks: number;
}

type Row = Record<string, unknown>;

/** 1000 件ずつ全部読む（Supabase は1回 1000 件まで） */
async function selectAll(
  query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function insertAll(admin: ReturnType<typeof createAdminClient>, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table} のコピーに失敗しました: ${error.message}`);
  }
}

/**
 * コピー元の店舗だけのメニュー（カテゴリ・商品・サイズ・トッピング・選択肢）と、メニューに関わるレジの設定を、
 * コピー先の店舗に入れる（運営管理だけ）。コピー先にもうメニューがあるときはしない（二重にならないように）。
 * 全店共通（store_id なし）のカテゴリ・商品はコピーしない（もう出ている）。品切れは外す。
 */
export async function copyStoreMenu(input: CopyStoreMenuInput): Promise<CopyStoreMenuResult> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const { organizationId: org, sourceStoreId: src, targetStoreId: dst } = input;
  if (src === dst) throw new Error('コピー元とコピー先が同じ店舗です');

  const { data: stores } = await admin.from('stores').select('id, name, organization_id').in('id', [src, dst]);
  const source = stores?.find((s) => s.id === src);
  const target = stores?.find((s) => s.id === dst);
  if (!source || !target || source.organization_id !== org || target.organization_id !== org) {
    throw new Error('店舗が見つかりません（同じ企業の店舗だけコピーできます）');
  }

  // コピー先が空か（二重にコピーしない）
  const [{ count: dstCats }, { count: dstItems }, { count: dstGroups }] = await Promise.all([
    admin.from('menu_categories').select('id', { count: 'exact', head: true }).eq('store_id', dst).neq('status', 'deleted'),
    admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('store_id', dst).neq('status', 'deleted'),
    admin.from('menu_option_groups').select('id', { count: 'exact', head: true }).eq('store_id', dst).neq('status', 'deleted'),
  ]);
  if ((dstCats ?? 0) + (dstItems ?? 0) + (dstGroups ?? 0) > 0) {
    throw new Error(`「${target.name}」にはもうメニューがあります。空の店舗にだけコピーできます`);
  }

  const cats = await selectAll((a, b) =>
    admin.from('menu_categories').select('*').eq('organization_id', org).eq('store_id', src).neq('status', 'deleted').order('sort_order').range(a, b)
  );
  const items = await selectAll((a, b) =>
    admin.from('menu_items').select('*').eq('organization_id', org).eq('store_id', src).neq('status', 'deleted').order('sort_order').range(a, b)
  );
  const groups = await selectAll((a, b) =>
    admin.from('menu_option_groups').select('*').eq('organization_id', org).eq('store_id', src).neq('status', 'deleted').order('sort_order').range(a, b)
  );
  const optItems = await selectAll((a, b) =>
    admin.from('menu_option_items').select('*').eq('organization_id', org).eq('store_id', src).neq('status', 'deleted').order('sort_order').range(a, b)
  );
  const links = await selectAll((a, b) =>
    admin.from('menu_item_option_groups').select('*').eq('organization_id', org).eq('store_id', src).order('sort_order').range(a, b)
  );
  const itemIds = items.map((i) => i.id as string);
  const variants: Row[] = [];
  const modLinks: Row[] = [];
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200);
    const [{ data: v, error: ve }, { data: m, error: me }] = await Promise.all([
      admin.from('menu_variants').select('*').in('menu_item_id', chunk).neq('status', 'deleted'),
      admin.from('menu_item_modifiers').select('*').in('menu_item_id', chunk),
    ]);
    if (ve || me) throw new Error((ve ?? me)!.message);
    variants.push(...(v ?? []));
    modLinks.push(...(m ?? []));
  }

  // 古い ID → 新しい ID
  const map = new Map<string, string>();
  for (const r of [...cats, ...items, ...groups, ...optItems]) map.set(r.id as string, crypto.randomUUID());
  const idOf = (old: unknown) => (typeof old === 'string' ? (map.get(old) ?? old) : old);
  const by = { created_by: ctx.userId, updated_by: ctx.userId };

  await insertAll(admin, 'menu_categories', cats.map((r) => cloneRow(r, { ...by, id: map.get(r.id as string), store_id: dst })));
  await insertAll(
    admin,
    'menu_items',
    items.map((r) =>
      cloneRow(r, { ...by, id: map.get(r.id as string), store_id: dst, category_id: idOf(r.category_id), is_sold_out: false })
    )
  );
  await insertAll(
    admin,
    'menu_variants',
    variants
      .filter((r) => map.has(r.menu_item_id as string))
      .map((r) => cloneRow(r, { ...by, id: crypto.randomUUID(), menu_item_id: map.get(r.menu_item_id as string) }))
  );
  await insertAll(
    admin,
    'menu_item_modifiers',
    modLinks
      .filter((r) => map.has(r.menu_item_id as string))
      .map((r) => ({ id: crypto.randomUUID(), menu_item_id: map.get(r.menu_item_id as string), modifier_id: r.modifier_id }))
  );
  await insertAll(admin, 'menu_option_groups', groups.map((r) => cloneRow(r, { ...by, id: map.get(r.id as string), store_id: dst })));
  await insertAll(
    admin,
    'menu_option_items',
    optItems
      .filter((r) => map.has(r.group_id as string))
      .map((r) => cloneRow(r, { ...by, id: map.get(r.id as string), store_id: dst, group_id: map.get(r.group_id as string) }))
  );
  const copiedLinks = links
    .filter((r) => map.has(r.group_id as string))
    .map((r) =>
      cloneRow(r, { ...by, id: crypto.randomUUID(), store_id: dst, menu_item_id: idOf(r.menu_item_id), group_id: map.get(r.group_id as string) })
    );
  await insertAll(admin, 'menu_item_option_groups', copiedLinks);

  // レジの設定（メニューに関わるものだけ。ID はコピー先のものに置き換える）
  const { data: srcSettings } = await admin
    .from('store_settings')
    .select(['settings', ...STORE_SETTINGS_COLUMNS_TO_COPY].join(', '))
    .eq('store_id', src)
    .maybeSingle();
  const { data: dstSettings } = await admin.from('store_settings').select('id, settings').eq('store_id', dst).maybeSingle();
  if (srcSettings) {
    const s = srcSettings as unknown as Row;
    const patch: Row = { settings: copyMenuSettings(s.settings, (dstSettings as Row | null)?.settings, map), updated_by: ctx.userId };
    for (const col of STORE_SETTINGS_COLUMNS_TO_COPY) if (col in s) patch[col] = s[col];
    if (dstSettings) {
      const { error } = await admin.from('store_settings').update(patch).eq('store_id', dst);
      if (error) throw new Error(`レジの設定のコピーに失敗しました: ${error.message}`);
    } else {
      const { error } = await admin.from('store_settings').insert({ organization_id: org, store_id: dst, ...patch });
      if (error) throw new Error(`レジの設定のコピーに失敗しました: ${error.message}`);
    }
  }

  const result: CopyStoreMenuResult = {
    categories: cats.length,
    items: items.length,
    variants: variants.filter((r) => map.has(r.menu_item_id as string)).length,
    optionGroups: groups.length,
    optionItems: optItems.filter((r) => map.has(r.group_id as string)).length,
    itemOptionLinks: copiedLinks.length,
    modifierLinks: modLinks.filter((r) => map.has(r.menu_item_id as string)).length,
  };

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: org,
    p_store: dst,
    p_action: 'store.menu_copy',
    p_target_table: 'menu_items',
    p_target_id: dst,
    p_before: null,
    p_after: { from_store: src, from_name: source.name, ...result },
    p_note: '運営管理：店舗のメニューをコピー',
  });

  revalidatePath(`/admin/organizations/${org}`);
  return result;
}
