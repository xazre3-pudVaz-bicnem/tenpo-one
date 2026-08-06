'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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
