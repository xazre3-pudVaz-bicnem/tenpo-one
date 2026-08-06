'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROLES, HQ_ROLES, type Role } from '@/lib/permissions';

export interface ActionResult {
  error?: string;
}

export interface InviteResult extends ActionResult {
  membershipId?: string;
}

function isStoreScopedRole(role: Role): boolean {
  return !HQ_ROLES.includes(role);
}

function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/** スタッフ招待。auth.users作成→profiles(トリガー自動生成)→memberships/membership_storesをadmin clientで作成 */
export async function inviteStaff(input: {
  email: string;
  displayName: string;
  displayNameKana: string;
  role: string;
  storeIds: string[];
  password: string;
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
  if (!input.password || input.password.length < 12) {
    return { error: '初期パスワードの生成に失敗しました。もう一度お試しください' };
  }

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
    password: input.password,
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
  return { membershipId: membership.id as string };
}

/** ロール変更（店舗系ロールの場合は所属店舗を同時指定） */
export async function changeMemberRole(input: {
  membershipId: string;
  profileId: string;
  newRole: string;
  storeIds: string[];
}): Promise<ActionResult> {
  const ctx = await requirePermission('staff.manage');

  if (input.profileId === ctx.userId) {
    return { error: '自分自身のロールは変更できません' };
  }
  if (!isValidRole(input.newRole)) {
    return { error: '不正なロールです' };
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };

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
    .select('id, role')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };
  if (!isStoreScopedRole(membership.role as Role)) {
    return { error: 'このロールは店舗割当の対象外です' };
  }

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
    .select('id')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };

  const admin = createAdminClient();
  const { error } = await admin.from('profiles').update({ pin_code: input.pin }).eq('id', input.profileId);
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

  if (input.profileId === ctx.userId) {
    return { error: '自分自身の利用停止はできません' };
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, status')
    .eq('id', input.membershipId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!membership) return { error: '対象のスタッフが見つかりません' };

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
