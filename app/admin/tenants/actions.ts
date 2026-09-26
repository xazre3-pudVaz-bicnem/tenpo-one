'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { normalizeStoreSlug } from '@/lib/store-slug';
import { ROLES } from '@/lib/permissions';
import {
  ENVIRONMENTS,
  STAGES,
  MODULES,
  HARDWARE_CATEGORIES,
  HARDWARE_STATUSES,
  canTransitionStage,
  evaluateGoLive,
  ALL_CHECKLIST_ITEMS,
  type Environment,
  type Stage,
  type HardwareCategory,
  type HardwareStatus,
  type ChecklistState,
} from '@/lib/tenant-onboarding';
import { computeStoreSignals } from './signals';
import { REGISTER_LOGIN_MESSAGE, isStoreUser, normalizeStoreUser } from '@/lib/register-login';
import { DEFAULT_HANDY_LIMIT, DEFAULT_REGISTER_LIMIT, MAX_ALLOWED_NETWORKS, limitFrom, toNetwork } from '@/lib/store-access';
import {
  assignOrgCode,
  assignStoreUsername,
  readStoreRegisterPassword,
  resetStoreRegisterPassword,
  setupStoreContract,
} from '@/lib/tenant-provisioning';

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'store'
  );
}
async function audit(orgId: string, storeId: string | null, action: string, targetTable: string, targetId: string, after: unknown, note: string | null = null) {
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: orgId,
    p_store: storeId,
    p_action: action,
    p_target_table: targetTable,
    p_target_id: targetId,
    p_before: null,
    p_after: after as never,
    p_note: note,
  });
}

// ---------------------------------------------------------------
// 新規店舗追加ウィザード（新規org または 既存orgへstore追加）＋Owner発行（任意）
// ---------------------------------------------------------------
export interface CreateTenantStoreInput {
  mode: 'new_org' | 'existing_org';
  organizationId?: string; // existing_org時
  companyName?: string; // new_org時
  companyNameKana?: string;
  planCode?: string;
  storeName: string;
  slug?: string;
  environment: Environment;
  ownerEmail?: string; // 任意（新org時は推奨）
  ownerName?: string;
  /** 契約: お店の回線（グローバルIP）。1件でも入れるとレジ・ハンディが制限される */
  storeIps?: { ip: string; label: string }[];
  /** 契約: レジ（iPad）の台数（既定2台） */
  registerLimit?: number;
  /** 契約: ハンディの台数（既定2台） */
  handyLimit?: number;
  /** レジのログインで打つ店舗ユーザー名（未指定なら店舗名から作る） */
  storeUser?: string;
}
export interface CreateTenantStoreResult {
  organizationId: string;
  storeId: string;
  slug: string;
  ownerEmail?: string;
  ownerPassword?: string; // 一度だけ表示
  /** レジ（iPad）のログインで使う（一度だけ表示） */
  orgCode?: string;
  storeUser?: string;
  registerPassword?: string;
}

export async function createTenantStore(input: CreateTenantStoreInput): Promise<CreateTenantStoreResult> {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const storeName = input.storeName.trim();
  if (!storeName) throw new Error('店舗名を入力してください');
  if (!ENVIRONMENTS.includes(input.environment)) throw new Error('環境の指定が不正です');

  let organizationId = input.organizationId ?? '';
  let createdOrg = false;

  // 新規org作成
  if (input.mode === 'new_org') {
    const companyName = input.companyName?.trim();
    if (!companyName) throw new Error('会社名を入力してください');
    const { data: org, error } = await admin
      .from('organizations')
      .insert({ name: companyName, name_kana: input.companyNameKana?.trim() || null, plan_code: input.planCode || 'standard', status: 'active' })
      .select('id')
      .single();
    if (error || !org) throw new Error(error?.message ?? '会社の作成に失敗しました');
    organizationId = org.id;
    createdOrg = true;
    await assignOrgCode(admin, organizationId);
    await audit(organizationId, null, 'organization.create', 'organizations', organizationId, { name: companyName });
  } else {
    if (!organizationId) throw new Error('対象の会社を選択してください');
    const { data: org } = await admin.from('organizations').select('id').eq('id', organizationId).maybeSingle();
    if (!org) throw new Error('対象の会社が見つかりません');
  }

  // slug決定（指定 or 店舗名から生成。重複はサフィックスで回避）
  const base = input.slug?.trim() ? slugify(input.slug) : slugify(storeName);
  let slug = base;
  let storeId = '';
  for (let attempt = 0; attempt <= 8; attempt++) {
    if (attempt > 0) slug = `${base}-${attempt}`;
    const { data: store, error } = await admin
      .from('stores')
      .insert({ organization_id: organizationId, slug, name: storeName })
      .select('id, slug')
      .single();
    if (!error && store) {
      storeId = store.id;
      slug = store.slug;
      break;
    }
    if (error?.code !== '23505') {
      if (createdOrg) await admin.from('organizations').delete().eq('id', organizationId);
      throw new Error(error?.message ?? '店舗の作成に失敗しました');
    }
  }
  if (!storeId) throw new Error('店舗の作成に失敗しました（slug重複を解消できませんでした）');

  // store_settings（トリガーで store_onboarding は自動生成される）
  await admin.from('store_settings').insert({ organization_id: organizationId, store_id: storeId });
  // 環境を指定値へ更新（トリガー既定はorg由来）
  await admin.from('store_onboarding').update({ environment: input.environment, stage: 'onboarding' }).eq('store_id', storeId);
  await audit(organizationId, storeId, 'store.create', 'stores', storeId, { name: storeName, slug, environment: input.environment });

  // Owner発行（任意）
  let ownerEmail: string | undefined;
  let ownerPassword: string | undefined;
  if (input.ownerEmail?.trim()) {
    const email = input.ownerEmail.trim().toLowerCase();
    const ownerName = input.ownerName?.trim() || email.split('@')[0];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('オーナーのメールアドレス形式が正しくありません');
    const password = randomPassword();
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: ownerName },
    });
    if (uErr || !created?.user) {
      if (/already|registered|exists/i.test(uErr?.message ?? '')) throw new Error('このメールアドレスは既に登録されています');
      throw new Error(`オーナー作成に失敗しました: ${uErr?.message ?? ''}`);
    }
    const { data: mem, error: mErr } = await admin
      .from('memberships')
      .insert({ organization_id: organizationId, profile_id: created.user.id, role: 'org_owner', status: 'active' })
      .select('id')
      .single();
    if (mErr || !mem) throw new Error(mErr?.message ?? 'オーナーのメンバー登録に失敗しました');
    // 店舗を主所属として関連付け（HQロールは全店舗アクセスだが、明示リンクしておく）
    await admin.from('membership_stores').insert({ membership_id: mem.id, store_id: storeId, is_primary: true });
    ownerEmail = email;
    ownerPassword = password;
    await audit(organizationId, storeId, 'tenant.owner_issue', 'memberships', mem.id as string, { email, role: 'org_owner' });
  }

  // レジのログインで打つ店舗ユーザー名
  const storeUser = await assignStoreUsername(admin, {
    organizationId,
    storeId,
    desired: input.storeUser,
    seed: input.slug?.trim() || slug || storeName,
  });

  // 契約の内容（お店の回線・レジ台数・ハンディ台数・レジ用パスワード）
  const contract = await setupStoreContract(admin, {
    organizationId,
    storeId,
    ips: input.storeIps ?? [],
    registerLimit: limitFrom(input.registerLimit, DEFAULT_REGISTER_LIMIT),
    handyLimit: limitFrom(input.handyLimit, DEFAULT_HANDY_LIMIT),
    updatedBy: null,
  });
  await audit(organizationId, storeId, 'admin.store_access_policy', 'store_access_policies', storeId, {
    networks: contract.networks.length,
    register_limit: contract.registerLimit,
    handy_limit: contract.handyLimit,
  });

  const { data: orgRow } = await admin.from('organizations').select('org_code').eq('id', organizationId).maybeSingle();

  revalidatePath('/admin/tenants');
  return {
    organizationId,
    storeId,
    slug,
    ownerEmail,
    ownerPassword,
    orgCode: (orgRow?.org_code as string | null) ?? undefined,
    storeUser: storeUser ?? undefined,
    registerPassword: contract.registerPassword,
  };
}

// ---------------------------------------------------------------
// Owner/スタッフ発行（既存店舗へ）
// ---------------------------------------------------------------
export async function issueStoreOwner(input: { storeId: string; email: string; displayName: string; role?: string; password?: string }): Promise<{ email: string; password: string }> {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim() || email.split('@')[0];
  const role = input.role || 'org_owner';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレス形式が正しくありません');

  // パスワードは任意指定可（空欄なら強力なランダムを自動生成）。指定時は8文字以上。
  const specified = input.password?.trim();
  if (specified && specified.length < 8) throw new Error('パスワードは8文字以上で指定してください');
  const password = specified || randomPassword();
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: displayName },
  });
  if (uErr || !created?.user) {
    if (/already|registered|exists/i.test(uErr?.message ?? '')) throw new Error('このメールアドレスは既に登録されています');
    throw new Error(`ユーザー作成に失敗しました: ${uErr?.message ?? ''}`);
  }
  const { data: mem, error: mErr } = await admin
    .from('memberships')
    .insert({ organization_id: store.organization_id, profile_id: created.user.id, role, status: 'active' })
    .select('id')
    .single();
  if (mErr || !mem) throw new Error(mErr?.message ?? 'メンバー登録に失敗しました');
  await admin.from('membership_stores').insert({ membership_id: mem.id, store_id: store.id, is_primary: role !== 'org_owner' });
  await audit(store.organization_id, store.id, 'tenant.owner_issue', 'memberships', mem.id as string, { email, role });
  revalidatePath(`/admin/tenants/${input.storeId}`);
  return { email, password };
}

/** パスワード再発行（任意指定可・空欄なら新しいランダム。平文保存しない） */
export async function resetUserPassword(input: { storeId: string; profileId: string; password?: string }): Promise<{ password: string }> {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const specified = input.password?.trim();
  if (specified && specified.length < 8) throw new Error('パスワードは8文字以上で指定してください');
  const password = specified || randomPassword();
  const { error } = await admin.auth.admin.updateUserById(input.profileId, { password });
  if (error) throw new Error(`パスワード再発行に失敗しました: ${error.message}`);
  await audit(store.organization_id, store.id, 'tenant.owner_password_reset', 'profiles', input.profileId, { reset: true });
  return { password };
}

/** メンバーのロール変更（CYPRESS運営のみ） */
export async function setMemberRole(input: { storeId: string; membershipId: string; role: string }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  if (!(ROLES as readonly string[]).includes(input.role)) throw new Error('不正なロールです');
  const { data: before } = await admin.from('memberships').select('role').eq('id', input.membershipId).eq('organization_id', store.organization_id).maybeSingle();
  if (!before) throw new Error('メンバーが見つかりません');
  const { error } = await admin.from('memberships').update({ role: input.role }).eq('id', input.membershipId).eq('organization_id', store.organization_id);
  if (error) throw new Error(error.message);
  await audit(store.organization_id, store.id, 'tenant.member_role', 'memberships', input.membershipId, { from: before.role, to: input.role });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

/** メンバーの所属店舗割当（membership_stores を置換）。HQロールは全店舗アクセスのため主に店舗スコープロール向け。 */
export async function setMemberStores(input: { storeId: string; membershipId: string; storeIds: string[] }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  // メンバーが対象組織のものか確認
  const { data: mem } = await admin.from('memberships').select('id').eq('id', input.membershipId).eq('organization_id', store.organization_id).maybeSingle();
  if (!mem) throw new Error('メンバーが見つかりません');
  // 指定店舗が対象組織のものか検証（他組織店舗の割当を防止）
  const storeIds = [...new Set(input.storeIds.filter(Boolean))];
  if (storeIds.length > 0) {
    const { data: valid } = await admin.from('stores').select('id').eq('organization_id', store.organization_id).in('id', storeIds);
    if ((valid?.length ?? 0) !== storeIds.length) throw new Error('指定された店舗が正しくありません');
  }
  // 置換
  await admin.from('membership_stores').delete().eq('membership_id', input.membershipId);
  if (storeIds.length > 0) {
    await admin.from('membership_stores').insert(storeIds.map((sid, i) => ({ membership_id: input.membershipId, store_id: sid, is_primary: i === 0 })));
  }
  await audit(store.organization_id, store.id, 'tenant.member_stores', 'memberships', input.membershipId, { store_ids: storeIds });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

/** メンバーの停止/再開（membership.status） */
export async function setMembershipStatus(input: { storeId: string; membershipId: string; status: 'active' | 'suspended' }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const { error } = await admin.from('memberships').update({ status: input.status }).eq('id', input.membershipId).eq('organization_id', store.organization_id);
  if (error) throw new Error(error.message);
  await audit(store.organization_id, store.id, 'tenant.member_status', 'memberships', input.membershipId, { status: input.status });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

// ---------------------------------------------------------------
// 導入状態
// ---------------------------------------------------------------
async function loadOnboarding(admin: ReturnType<typeof createAdminClient>, storeId: string) {
  const { data } = await admin.from('store_onboarding').select('*').eq('store_id', storeId).maybeSingle();
  if (!data) throw new Error('導入情報が見つかりません');
  return data;
}

export async function updateStage(input: { storeId: string; stage: Stage }) {
  await requireCypressAdmin();
  if (!STAGES.includes(input.stage)) throw new Error('不正なステージです');
  const admin = createAdminClient();
  const ob = await loadOnboarding(admin, input.storeId);
  if (ob.stage !== input.stage && !canTransitionStage(ob.stage as Stage, input.stage)) {
    throw new Error(`「${ob.stage}」から「${input.stage}」へは遷移できません`);
  }
  const { error } = await admin.from('store_onboarding').update({ stage: input.stage, updated_at: new Date().toISOString() }).eq('store_id', input.storeId);
  if (error) throw new Error(error.message);
  await audit(ob.organization_id, input.storeId, 'onboarding.stage', 'store_onboarding', input.storeId, { from: ob.stage, to: input.stage });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function setEnvironment(input: { storeId: string; environment: Environment }) {
  await requireCypressAdmin();
  if (!ENVIRONMENTS.includes(input.environment)) throw new Error('不正な環境です');
  const admin = createAdminClient();
  const ob = await loadOnboarding(admin, input.storeId);
  const { error } = await admin.from('store_onboarding').update({ environment: input.environment, updated_at: new Date().toISOString() }).eq('store_id', input.storeId);
  if (error) throw new Error(error.message);
  await audit(ob.organization_id, input.storeId, 'onboarding.environment', 'store_onboarding', input.storeId, { from: ob.environment, to: input.environment });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function setEnabledModules(input: { storeId: string; modules: string[] }) {
  await requireCypressAdmin();
  const modules = input.modules.filter((m) => (MODULES as readonly string[]).includes(m));
  const admin = createAdminClient();
  const ob = await loadOnboarding(admin, input.storeId);
  const { error } = await admin.from('store_onboarding').update({ enabled_modules: modules, updated_at: new Date().toISOString() }).eq('store_id', input.storeId);
  if (error) throw new Error(error.message);
  await audit(ob.organization_id, input.storeId, 'onboarding.modules', 'store_onboarding', input.storeId, { modules });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function toggleChecklistItem(input: { storeId: string; itemKey: string; done: boolean }) {
  const ctx = await requireCypressAdmin();
  const item = ALL_CHECKLIST_ITEMS.find((i) => i.key === input.itemKey);
  if (!item || item.kind !== 'manual') throw new Error('この項目は手動チェックの対象ではありません');
  const admin = createAdminClient();
  const ob = await loadOnboarding(admin, input.storeId);
  const checklist = { ...((ob.checklist as ChecklistState) ?? {}) };
  checklist[input.itemKey] = { done: input.done, by: ctx.userId, at: new Date().toISOString() };
  const { error } = await admin.from('store_onboarding').update({ checklist, updated_at: new Date().toISOString() }).eq('store_id', input.storeId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

/** Go Live承認: サーバー側でCritical充足を再判定してから live へ */
export async function approveGoLive(input: { storeId: string }): Promise<{ ok: boolean; blockers?: string[] }> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const ob = await loadOnboarding(admin, input.storeId);
  const { data: store } = await admin.from('stores').select('id, organization_id, slug, seat_count, booking_enabled').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const signals = await computeStoreSignals(admin, store);
  const result = evaluateGoLive(signals, (ob.checklist as ChecklistState) ?? {}, ob.enabled_modules ?? []);
  if (!result.ready) {
    return { ok: false, blockers: result.blockers.map((b) => b.label) };
  }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const { error } = await admin
    .from('store_onboarding')
    .update({ stage: 'live', go_live_at: new Date().toISOString(), go_live_by: ctx.userId, opened_on: ob.opened_on ?? today, updated_at: new Date().toISOString() })
    .eq('store_id', input.storeId);
  if (error) throw new Error(error.message);
  await audit(ob.organization_id, input.storeId, 'store.go_live', 'store_onboarding', input.storeId, { opened_on: ob.opened_on ?? today });
  revalidatePath(`/admin/tenants/${input.storeId}`);
  return { ok: true };
}

// ---------------------------------------------------------------
// ハードウェア
// ---------------------------------------------------------------
export async function addHardware(input: { storeId: string; category: HardwareCategory; provider?: string; model?: string; connection?: string; ipAddress?: string; status?: HardwareStatus; note?: string }) {
  await requireCypressAdmin();
  if (!HARDWARE_CATEGORIES.includes(input.category)) throw new Error('不正な機器種別です');
  const status = input.status && HARDWARE_STATUSES.includes(input.status) ? input.status : 'planned';
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const { data: hw, error } = await admin
    .from('store_hardware')
    .insert({
      organization_id: store.organization_id, store_id: store.id, category: input.category,
      provider: input.provider?.trim() || null, model: input.model?.trim() || null,
      connection: input.connection?.trim() || null, ip_address: input.ipAddress?.trim() || null,
      status, note: input.note?.trim() || null,
    })
    .select('id')
    .single();
  if (error || !hw) throw new Error(error?.message ?? '機器の登録に失敗しました');
  await audit(store.organization_id, store.id, 'hardware.add', 'store_hardware', hw.id as string, { category: input.category, provider: input.provider, status });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function updateHardware(input: { storeId: string; hardwareId: string; status?: HardwareStatus; note?: string }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status && HARDWARE_STATUSES.includes(input.status)) patch.status = input.status;
  if (input.note !== undefined) patch.note = input.note.trim() || null;
  const { error } = await admin.from('store_hardware').update(patch).eq('id', input.hardwareId).eq('store_id', store.id);
  if (error) throw new Error(error.message);
  await audit(store.organization_id, store.id, 'hardware.update', 'store_hardware', input.hardwareId, patch);
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function removeHardware(input: { storeId: string; hardwareId: string }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const { error } = await admin.from('store_hardware').delete().eq('id', input.hardwareId).eq('store_id', store.id);
  if (error) throw new Error(error.message);
  await audit(store.organization_id, store.id, 'hardware.remove', 'store_hardware', input.hardwareId, { removed: true });
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

// ---------------------------------------------------------------
// サポートメモ（CYPRESS内部のみ）
// ---------------------------------------------------------------
export async function addSupportNote(input: { storeId: string; body: string }) {
  const ctx = await requireCypressAdmin();
  const body = input.body.trim();
  if (!body) throw new Error('メモを入力してください');
  if (body.length > 2000) throw new Error('メモは2000文字以内で入力してください');
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) throw new Error('店舗が見つかりません');
  const { error } = await admin.from('tenant_support_notes').insert({
    organization_id: store.organization_id, store_id: store.id, body, author_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

export async function deleteSupportNote(input: { storeId: string; noteId: string }) {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from('tenant_support_notes').delete().eq('id', input.noteId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/tenants/${input.storeId}`);
}

/* ------------------------------------------------------------ アクセス制限（契約） */

/**
 * 店舗のアクセス制限（お店の回線・レジ端末の台数）を設定する。運営だけが変更できる。
 * 回線を1つも登録していない店舗は制限なし（今まで通り使える）。
 */
export async function saveStoreAccessPolicy(input: {
  storeId: string;
  ips: { ip: string; label: string }[];
  registerLimit: number;
  handyLimit: number;
  networkEnforced: boolean;
  note: string;
}): Promise<{ error?: string }> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) return { error: '店舗が見つかりません' };

  const networks: { key: string; label: string }[] = [];
  for (const row of input.ips ?? []) {
    if (!row.ip.trim()) continue;
    const net = toNetwork(row.ip, row.label ?? '');
    if (!net) return { error: `IPアドレスの形が正しくありません: ${row.ip}` };
    if (!networks.some((n) => n.key === net.key)) networks.push(net);
  }
  if (networks.length > MAX_ALLOWED_NETWORKS) return { error: `回線は${MAX_ALLOWED_NETWORKS}件までです` };
  const limit = limitFrom(input.registerLimit, DEFAULT_REGISTER_LIMIT);
  const handyLimit = limitFrom(input.handyLimit, DEFAULT_HANDY_LIMIT);

  const { error } = await admin.from('store_access_policies').upsert(
    {
      store_id: input.storeId,
      organization_id: store.organization_id as string,
      networks,
      network_enforced: input.networkEnforced === true,
      register_limit: limit,
      handy_limit: handyLimit,
      note: input.note?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };

  await admin.rpc('log_audit', {
    p_org: store.organization_id as string,
    p_store: input.storeId,
    p_action: 'admin.store_access_policy',
    p_target_table: 'store_access_policies',
    p_target_id: input.storeId,
    p_before: null,
    p_after: { networks: networks.length, network_enforced: input.networkEnforced === true, register_limit: limit, handy_limit: handyLimit },
    p_note: input.note?.slice(0, 200) ?? null,
  });

  revalidatePath(`/admin/tenants/${input.storeId}`);
  return {};
}

/** レジ端末（iPad）の登録を解除する。解除するとその端末ではレジを開けなくなる */
export async function revokeRegisterDevice(input: { storeId: string; deviceId: string }): Promise<{ error?: string }> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from('register_devices')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
    .eq('id', input.deviceId)
    .eq('store_id', input.storeId);
  if (error) return { error: `解除に失敗しました: ${error.message}` };
  revalidatePath(`/admin/tenants/${input.storeId}`);
  return {};
}

/**
 * レジ用パスワードを作り直す（運営だけ）。
 * 店舗・オーナーからは変更できない。作り直すと、今ログインしているレジは入り直しになる。
 */
export async function reissueRegisterPassword(input: { storeId: string }): Promise<{ password?: string; error?: string }> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) return { error: '店舗が見つかりません' };
  try {
    const password = await resetStoreRegisterPassword(admin, {
      organizationId: store.organization_id as string,
      storeId: input.storeId,
      updatedBy: ctx.userId,
    });
    await audit(store.organization_id as string, input.storeId, 'admin.register_password_reissue', 'store_register_credentials', input.storeId, {
      reissued: true,
    });
    revalidatePath(`/admin/tenants/${input.storeId}`);
    return { password };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '作り直しに失敗しました' };
  }
}

/**
 * 今のレジ用パスワードを運営が見る（運営だけ）。
 * 店から「忘れた」と電話が来たときに、営業を止めずに答えるための機能。
 * 誰がいつ見たかは監査ログに残す。
 */
export async function revealRegisterPassword(input: { storeId: string }): Promise<{
  password?: string;
  updatedAt?: string | null;
  notSet?: boolean;
  error?: string;
}> {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) return { error: '店舗が見つかりません' };

  const found = await readStoreRegisterPassword(admin, input.storeId);
  if (!found.exists) return { notSet: true };
  if (!found.password) {
    return { error: 'このパスワードは表示できません（古い発行分です）。「パスワードを作り直す」で新しく発行してください' };
  }
  await audit(store.organization_id as string, input.storeId, 'admin.register_password_reveal', 'store_register_credentials', input.storeId, {
    viewed: true,
  });
  return { password: found.password, updatedAt: found.updatedAt };
}

/** 店舗ユーザー名（レジのログインで打つ名前）を変える。運営だけ */
export async function saveStoreRegisterUsername(input: { storeId: string; username: string }): Promise<{ username?: string; error?: string }> {
  await requireCypressAdmin();
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, name, organization_id').eq('id', input.storeId).maybeSingle();
  if (!store) return { error: '店舗が見つかりません' };

  const wanted = normalizeStoreUser(input.username ?? '');
  if (!isStoreUser(wanted)) return { error: REGISTER_LOGIN_MESSAGE.badStoreUser };

  const { error } = await admin.from('stores').update({ register_username: wanted }).eq('id', input.storeId);
  if (error) {
    if (error.code === '23505') return { error: 'この店舗ユーザー名は、同じ会社の別の店舗で使われています' };
    return { error: `保存に失敗しました: ${error.message}` };
  }
  await audit(store.organization_id as string, input.storeId, 'admin.store_register_username', 'stores', input.storeId, {
    register_username: wanted,
  });
  revalidatePath(`/admin/tenants/${input.storeId}`);
  revalidatePath(`/admin/organizations/${store.organization_id as string}`);
  return { username: wanted };
}

/**
 * 公開予約URLのスラッグ（stores.slug）を変える（運営だけ。2026-09-27 Ronnie「店舗からは変えられないように」）。
 * 変えると、これまでに配った予約URL・QRコードは開けなくなる（画面側で確認する）。
 */
export async function updateTenantStoreSlug(input: { storeId: string; slug: string }): Promise<{ error?: string }> {
  await requireCypressAdmin();
  const { slug, error: slugError } = normalizeStoreSlug(input.slug);
  if (slugError) return { error: slugError };
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, organization_id, slug').eq('id', input.storeId).maybeSingle();
  if (!store) return { error: '店舗が見つかりません' };
  if (store.slug === slug) return {};
  const { error } = await admin.from('stores').update({ slug }).eq('id', input.storeId);
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'この予約URL（スラッグ）は既に使われています。別の文字列を指定してください' };
    return { error: `予約URLの変更に失敗しました: ${error.message}` };
  }
  await audit(store.organization_id as string, input.storeId, 'admin.store.slug_update', 'stores', input.storeId, { before: store.slug, after: slug }, '公開予約URLのスラッグを変更（既存URL・QRは無効化）');
  revalidatePath(`/admin/tenants/${input.storeId}`);
  revalidatePath('/admin/stores');
  revalidatePath('/app/settings/booking');
  revalidatePath('/app/settings/store');
  return {};
}
