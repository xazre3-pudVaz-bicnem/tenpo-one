'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
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
}
export interface CreateTenantStoreResult {
  organizationId: string;
  storeId: string;
  slug: string;
  ownerEmail?: string;
  ownerPassword?: string; // 一度だけ表示
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

  revalidatePath('/admin/tenants');
  return { organizationId, storeId, slug, ownerEmail, ownerPassword };
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
