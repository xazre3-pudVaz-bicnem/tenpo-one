'use server';

import { randomBytes, scrypt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROLES, HQ_ROLES, canAssignRole, roleOutranks, type Role } from '@/lib/permissions';

export interface ActionResult {
  error?: string;
}

export interface InviteResult extends ActionResult {
  membershipId?: string;
  /** サーバー側で生成した初期パスワード（招待完了時に一度だけ呼び出し元へ返す。ログ・監査ログには残さない） */
  initialPassword?: string;
}

export interface ResetPasswordResult extends ActionResult {
  /** サーバー側で再生成した新パスワード（再発行時に一度だけ呼び出し元へ返す。ログ・監査ログには残さない） */
  newPassword?: string;
}

function isStoreScopedRole(role: Role): boolean {
  return !HQ_ROLES.includes(role);
}

function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/** targetRole が actorRole より上位（序列上）なら true。既存メンバーの操作可否判定に使用する（役職序列は lib/permissions.ts に一元化）。 */
function outranks(actorRole: Role, targetRole: Role): boolean {
  return roleOutranks(actorRole, targetRole);
}

/**
 * 対象メンバーの所属店舗と caller（ctx）の担当店舗が交差するかを検証する。
 * HQ系ロール（org_owner/hq_admin/hq_accounting/external_accountant、ctx.isHq=true）は
 * 全店舗アクセス権を持つため対象外。店舗系ロールの store_manager/area_manager が
 * 自分の担当外の店舗のスタッフを操作できてしまう権限昇格（H2）を防ぐ。
 */
async function assertManageableMemberStores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: { isHq: boolean; stores: { id: string }[] },
  membershipId: string
): Promise<string | null> {
  if (ctx.isHq) return null;
  const { data: rows } = await supabase
    .from('membership_stores')
    .select('store_id')
    .eq('membership_id', membershipId);
  const targetStoreIds = new Set((rows ?? []).map((r) => r.store_id as string));
  // HQ系ロールのメンバー（店舗割当なし）は非HQのcallerからは操作不可
  if (targetStoreIds.size === 0) return '担当外のスタッフです';
  const overlaps = ctx.stores.some((s) => targetStoreIds.has(s.id));
  return overlaps ? null : '担当外の店舗のスタッフです';
}

const INITIAL_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 初期パスワードをサーバー側で生成する（呼び出し側からは受け取らない）。node:crypto の暗号学的乱数を使用。 */
function generateInitialPassword(length = 16): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += INITIAL_PASSWORD_CHARS[bytes[i] % INITIAL_PASSWORD_CHARS.length];
  }
  return out;
}

const PIN_HASH_PREFIX = 'scrypt';

/**
 * 共用端末打刻用PINをハッシュ化する（Node標準 crypto.scrypt・ソルト付き）。
 * 既存カラム profiles.pin_code の型はそのままで、自己記述形式の文字列を格納する。
 * 形式: `scrypt$<saltHex>$<hashHex>`
 */
async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, 32, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey as Buffer)));
  });
  return `${PIN_HASH_PREFIX}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** スタッフ招待。auth.users作成→profiles(トリガー自動生成)→memberships/membership_storesをadmin clientで作成 */
export async function inviteStaff(input: {
  email: string;
  displayName: string;
  displayNameKana: string;
  role: string;
  storeIds: string[];
}): Promise<InviteResult> {
  const ctx = await requirePermission('staff.manage');

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const displayNameKana = input.displayNameKana.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'メールアドレスの形式が正しくありません' };
  }
  if (!displayName) {
    return { error: '氏名を入力してください' };
  }
  if (!isValidRole(input.role)) {
    return { error: '不正なロールです' };
  }
  if (!canAssignRole(ctx.role, input.role)) {
    return { error: '自分より上位のロールを付与することはできません' };
  }
  // 初期パスワードは呼び出し側（クライアント）から受け取らず、サーバー側で暗号学的乱数から生成する
  const initialPassword = generateInitialPassword();

  const storeScoped = isStoreScopedRole(input.role);
  const storeIds = Array.from(new Set(input.storeIds));
  const allowedStoreIds = new Set(ctx.stores.map((s) => s.id));

  if (storeScoped) {
    if (storeIds.length === 0) {
      return { error: '店舗系ロールは所属店舗を1つ以上選択してください' };
    }
    if (!storeIds.every((id) => allowedStoreIds.has(id))) {
      return { error: '選択した店舗にアクセス権がありません' };
    }
  }

  const admin = createAdminClient();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      display_name_kana: displayNameKana || null,
    },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? '';
    if (/already|registered|exists/i.test(msg)) {
      return { error: 'このメールアドレスは既に登録されています' };
    }
    return { error: `招待に失敗しました: ${msg || '不明なエラー'}` };
  }

  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .insert({
      organization_id: ctx.organizationId,
      profile_id: created.user.id,
      role: input.role,
      status: 'invited',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();

  if (memErr || !membership) {
    return { error: `メンバー登録に失敗しました: ${memErr?.message ?? '不明なエラー'}` };
  }

  if (storeScoped && storeIds.length > 0) {
    const rows = storeIds.map((storeId, i) => ({
      membership_id: membership.id as string,
      store_id: storeId,
      is_primary: i === 0,
    }));
    const { error: msErr } = await admin.from('membership_stores').insert(rows);
    if (msErr) {
      return { error: `店舗割当に失敗しました: ${msErr.message}` };
    }
  }

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'staff.invite',
    p_target_table: 'memberships',
    p_target_id: membership.id as string,
    p_before: null,
    p_after: { role: input.role, email, store_ids: storeIds },
    p_note: null,
  });

  revalidatePath('/app/staff');
  // 初期パスワードはこのレスポンスでのみ呼び出し元（招待した管理者）に一度だけ返す。
  // 監査ログ（log_audit）・サーバーログには一切出力しない。
  return { membershipId: membership.id as string, initialPassword };
}

/** ロール変更（店舗系ロールの場合は所属店舗を同時指定） */
export async function changeMemberRole(input: {
  membershipId: string;
  profileId: string;
  newRole: string;
  storeIds: string[];
}): Promise<ActionResult> {
  const ctx = await requirePermission('staff.manage');

  if (!isValidRole(input.newRole)) {
    return { error: '不正なロールです' };
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role, profile_id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  // profileIdはクライアント入力を信用せず、membershipIdから引いた実際の値と一致することを確認する
  if (membership.profile_id !== input.profileId) {
    return { error: '対象のスタッフが見つかりません' };
  }
  if (membership.profile_id === ctx.userId) {
    return { error: '自分自身のロールは変更できません' };
  }
  if (outranks(ctx.role, membership.role as Role)) {
    return { error: '自分より上位のロールのスタッフは変更できません' };
  }
  if (!canAssignRole(ctx.role, input.newRole)) {
    return { error: '自分より上位のロールへ変更することはできません' };
  }
  const scopeError = await assertManageableMemberStores(supabase, ctx, input.membershipId);
  if (scopeError) return { error: scopeError };

  const storeScoped = isStoreScopedRole(input.newRole);
  const storeIds = Array.from(new Set(input.storeIds));
  const allowedStoreIds = new Set(ctx.stores.map((s) => s.id));

  if (storeScoped) {
    if (storeIds.length === 0) {
      return { error: '店舗系ロールは所属店舗を1つ以上選択してください' };
    }
    if (!storeIds.every((id) => allowedStoreIds.has(id))) {
      return { error: '選択した店舗にアクセス権がありません' };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('memberships')
    .update({ role: input.newRole, updated_by: ctx.userId })
    .eq('id', input.membershipId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  await admin.from('membership_stores').delete().eq('membership_id', input.membershipId);
  if (storeScoped && storeIds.length > 0) {
    await admin.from('membership_stores').insert(
      storeIds.map((storeId, i) => ({ membership_id: input.membershipId, store_id: storeId, is_primary: i === 0 }))
    );
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'staff.role_change',
    p_target_table: 'memberships',
    p_target_id: input.membershipId,
    p_before: { role: membership.role },
    p_after: { role: input.newRole, store_ids: storeIds },
    p_note: null,
  });

  revalidatePath('/app/staff');
  return {};
}

/** 所属店舗の差し替え（店舗系ロールのみ対象） */
export async function changeMemberStores(input: {
  membershipId: string;
  profileId: string;
  storeIds: string[];
}): Promise<ActionResult> {
  const ctx = await requirePermission('staff.manage');

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role, profile_id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  if (membership.profile_id !== input.profileId) {
    return { error: '対象のスタッフが見つかりません' };
  }
  if (outranks(ctx.role, membership.role as Role)) {
    return { error: '自分より上位のロールのスタッフは変更できません' };
  }
  if (!isStoreScopedRole(membership.role as Role)) {
    return { error: 'このロールは店舗割当の対象外です' };
  }
  const scopeError = await assertManageableMemberStores(supabase, ctx, input.membershipId);
  if (scopeError) return { error: scopeError };

  const storeIds = Array.from(new Set(input.storeIds));
  if (storeIds.length === 0) return { error: '所属店舗を1つ以上選択してください' };
  const allowedStoreIds = new Set(ctx.stores.map((s) => s.id));
  if (!storeIds.every((id) => allowedStoreIds.has(id))) {
    return { error: '選択した店舗にアクセス権がありません' };
  }

  const { data: before } = await supabase
    .from('membership_stores')
    .select('store_id')
    .eq('membership_id', input.membershipId);

  const admin = createAdminClient();
  await admin.from('membership_stores').delete().eq('membership_id', input.membershipId);
  const { error } = await admin.from('membership_stores').insert(
    storeIds.map((storeId, i) => ({ membership_id: input.membershipId, store_id: storeId, is_primary: i === 0 }))
  );
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'staff.store_assign',
    p_target_table: 'membership_stores',
    p_target_id: input.membershipId,
    p_before: { store_ids: (before ?? []).map((b) => b.store_id) },
    p_after: { store_ids: storeIds },
    p_note: null,
  });

  revalidatePath('/app/staff');
  return {};
}

/** 共用端末打刻用PINの設定（4〜6桁数字） */
export async function setMemberPin(input: {
  membershipId: string;
  profileId: string;
  pin: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission('staff.manage');

  if (!/^\d{4,6}$/.test(input.pin)) {
    return { error: 'PINは4〜6桁の数字で入力してください' };
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role, profile_id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  if (membership.profile_id !== input.profileId) {
    return { error: '対象のスタッフが見つかりません' };
  }
  if (outranks(ctx.role, membership.role as Role)) {
    return { error: '自分より上位のロールのスタッフは変更できません' };
  }
  const scopeError = await assertManageableMemberStores(supabase, ctx, input.membershipId);
  if (scopeError) return { error: scopeError };

  const hashedPin = await hashPin(input.pin);
  const admin = createAdminClient();
  const { error } = await admin.from('profiles').update({ pin_code: hashedPin }).eq('id', membership.profile_id);
  if (error) return { error: `PIN設定に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'staff.pin_change',
    p_target_table: 'profiles',
    p_target_id: input.profileId,
    p_before: null,
    p_after: null,
    p_note: '共用端末打刻用PINを更新しました',
  });

  revalidatePath('/app/staff');
  return {};
}

/** 利用停止・再開（memberships.status） */
export async function setMemberStatus(input: {
  membershipId: string;
  profileId: string;
  status: 'active' | 'suspended';
  reason?: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission('staff.manage');

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, status, role, profile_id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  if (membership.profile_id !== input.profileId) {
    return { error: '対象のスタッフが見つかりません' };
  }
  if (membership.profile_id === ctx.userId) {
    return { error: '自分自身の利用停止はできません' };
  }
  if (outranks(ctx.role, membership.role as Role)) {
    return { error: '自分より上位のロールのスタッフは変更できません' };
  }
  const scopeError = await assertManageableMemberStores(supabase, ctx, input.membershipId);
  if (scopeError) return { error: scopeError };

  const admin = createAdminClient();
  const { error } = await admin
    .from('memberships')
    .update({ status: input.status, updated_by: ctx.userId })
    .eq('id', input.membershipId);
  if (error) return { error: `更新に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: input.status === 'suspended' ? 'staff.suspend' : 'staff.reactivate',
    p_target_table: 'memberships',
    p_target_id: input.membershipId,
    p_before: { status: membership.status },
    p_after: { status: input.status },
    p_note: input.reason || null,
  });

  revalidatePath('/app/staff');
  return {};
}

/**
 * スタッフのログインパスワードを再発行する。
 * 招待時の初期パスワードを取りこぼした・忘れた場合に、オーナー／管理者が新パスワードを再生成して
 * 本人へ手渡すための導線。メール送信は行わない（外部メールプロバイダ未接続のため）。
 * 新パスワードはこのレスポンスでのみ一度だけ返し、監査ログ・サーバーログには一切残さない。
 */
export async function resetMemberPassword(input: {
  membershipId: string;
  profileId: string;
}): Promise<ResetPasswordResult> {
  const ctx = await requirePermission('staff.manage');

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role, profile_id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  if (membership.profile_id !== input.profileId) {
    return { error: '対象のスタッフが見つかりません' };
  }
  if (membership.profile_id === ctx.userId) {
    return { error: '自分自身のパスワードはプロフィール設定から変更してください' };
  }
  if (outranks(ctx.role, membership.role as Role)) {
    return { error: '自分より上位のロールのスタッフは変更できません' };
  }
  const scopeError = await assertManageableMemberStores(supabase, ctx, input.membershipId);
  if (scopeError) return { error: scopeError };

  const newPassword = generateInitialPassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(membership.profile_id, {
    password: newPassword,
  });
  if (error) return { error: `パスワード再発行に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'staff.password_reset',
    p_target_table: 'profiles',
    p_target_id: input.profileId,
    p_before: null,
    p_after: null,
    p_note: 'ログインパスワードを再発行しました（新パスワードは監査ログに残しません）',
  });

  revalidatePath('/app/staff');
  // 新パスワードはこのレスポンスでのみ一度だけ返す（ログ・監査ログには残さない）。
  return { newPassword };
}
