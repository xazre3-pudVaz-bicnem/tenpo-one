'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ConsentType } from '@/components/customers/labels';

function nullIfEmpty(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

export interface CreateCustomerInput {
  name: string;
  nameKana: string;
  phone: string;
  email: string;
  birthday: string;
  allergyNote: string;
  preferenceNote: string;
  serviceNote: string;
}

/** 顧客を新規登録する */
export async function createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
  const ctx = await requirePermission('customers.write');
  const name = input.name.trim();
  if (!name) throw new Error('名前を入力してください');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .insert({
      organization_id: ctx.organizationId,
      primary_store_id: ctx.currentStore?.id ?? null,
      name,
      name_kana: nullIfEmpty(input.nameKana),
      phone: nullIfEmpty(input.phone),
      email: nullIfEmpty(input.email),
      birthday: nullIfEmpty(input.birthday),
      allergy_note: nullIfEmpty(input.allergyNote),
      preference_note: nullIfEmpty(input.preferenceNote),
      service_note: nullIfEmpty(input.serviceNote),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? '顧客の登録に失敗しました');

  revalidatePath('/app/customers');
  return { id: data.id as string };
}

export interface UpdateBasicInput {
  name: string;
  nameKana: string;
  phone: string;
  email: string;
  birthday: string;
  gender: string;
  postalCode: string;
  address: string;
}

/** 基本情報の更新 */
export async function updateCustomerBasic(customerId: string, input: UpdateBasicInput) {
  const ctx = await requirePermission('customers.write');
  const name = input.name.trim();
  if (!name) throw new Error('名前を入力してください');

  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({
      name,
      name_kana: nullIfEmpty(input.nameKana),
      phone: nullIfEmpty(input.phone),
      email: nullIfEmpty(input.email),
      birthday: nullIfEmpty(input.birthday),
      gender: nullIfEmpty(input.gender),
      postal_code: nullIfEmpty(input.postalCode),
      address: nullIfEmpty(input.address),
      updated_by: ctx.userId,
    })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath('/app/customers');
}

export interface UpdateAttributesInput {
  allergyNote: string;
  dislikeNote: string;
  preferenceNote: string;
  seatPreference: string;
  anniversaryNote: string;
  serviceNote: string;
}

/** 顧客属性（アレルギー・苦手・好み等）の更新 */
export async function updateCustomerAttributes(customerId: string, input: UpdateAttributesInput) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({
      allergy_note: nullIfEmpty(input.allergyNote),
      dislike_note: nullIfEmpty(input.dislikeNote),
      preference_note: nullIfEmpty(input.preferenceNote),
      seat_preference: nullIfEmpty(input.seatPreference),
      anniversary_note: nullIfEmpty(input.anniversaryNote),
      service_note: nullIfEmpty(input.serviceNote),
      updated_by: ctx.userId,
    })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

/** 来店・累計額などの集計を再計算する（recalc_customer_stats RPC） */
export async function recalcCustomerStats(customerId: string) {
  await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase.rpc('recalc_customer_stats', { p_customer_id: customerId });
  if (error) throw new Error(error.message);
  revalidatePath(`/app/customers/${customerId}`);
}

/** 顧客の論理削除（監査ログ記録の上、一覧へ戻る） */
export async function deleteCustomer(customerId: string, reason: string) {
  const ctx = await requirePermission('customers.delete');
  if (!reason.trim()) throw new Error('削除理由を入力してください');

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('customers')
    .select('name, status')
    .eq('id', customerId)
    .single();
  if (!before) throw new Error('顧客が見つかりません');

  const { error } = await supabase
    .from('customers')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: ctx.currentStore?.id ?? null,
    p_action: 'customer.delete',
    p_target_table: 'customers',
    p_target_id: customerId,
    p_before: { status: before.status },
    p_after: { status: 'deleted' },
    p_note: reason.trim(),
  });

  revalidatePath('/app/customers');
  revalidatePath(`/app/customers/${customerId}`);
}

/** 接客メモの追加 */
export async function addCustomerNote(customerId: string, body: string) {
  const ctx = await requirePermission('customers.write');
  const text = body.trim();
  if (!text) throw new Error('メモ内容を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.from('customer_notes').insert({
    organization_id: ctx.organizationId,
    customer_id: customerId,
    store_id: ctx.currentStore?.id ?? null,
    body: text,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

/** 配信・個人情報同意の更新（granted/granted_atをupsert） */
export async function updateCustomerConsent(customerId: string, consentType: ConsentType, granted: boolean) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_consents')
    .upsert(
      {
        organization_id: ctx.organizationId,
        customer_id: customerId,
        consent_type: consentType,
        granted,
        granted_at: granted ? new Date().toISOString() : null,
        source: 'staff_manual',
      },
      { onConflict: 'customer_id,consent_type' }
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

/** 新規タグの作成 */
export async function createCustomerTag(name: string, color: string): Promise<{ id: string }> {
  const ctx = await requirePermission('customers.write');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('タグ名を入力してください');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_tags')
    .insert({
      organization_id: ctx.organizationId,
      name: trimmed,
      color: color || '#7B3FF2',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'タグの作成に失敗しました');

  return { id: data.id as string };
}

/** 顧客へのタグ付け */
export async function attachCustomerTag(customerId: string, tagId: string) {
  await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_tag_links')
    .insert({ customer_id: customerId, tag_id: tagId });
  if (error && error.code !== '23505') throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

/** 顧客からのタグ取り外し */
export async function detachCustomerTag(customerId: string, tagId: string) {
  await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_tag_links')
    .delete()
    .eq('customer_id', customerId)
    .eq('tag_id', tagId);
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}
