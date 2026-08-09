'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ConsentType } from '@/components/customers/labels';
import { withErrorCapture } from '@/lib/observability-server';

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
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!customer) throw new Error('顧客が見つかりません');
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

/**
 * customer_tag_links の RLS は親テーブル(customers)の存在のみを見ており組織スコープが無いため、
 * customerId・tagId が自組織のものであることを必ずここで検証してから操作する。
 */
async function assertOwnCustomerAndTag(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  customerId: string,
  tagId: string
) {
  const [{ data: customer }, { data: tag }] = await Promise.all([
    supabase.from('customers').select('id').eq('id', customerId).eq('organization_id', organizationId).maybeSingle(),
    supabase.from('customer_tags').select('id').eq('id', tagId).eq('organization_id', organizationId).maybeSingle(),
  ]);
  if (!customer) throw new Error('顧客が見つかりません');
  if (!tag) throw new Error('タグが見つかりません');
}

/** 顧客へのタグ付け */
export async function attachCustomerTag(customerId: string, tagId: string) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  await assertOwnCustomerAndTag(supabase, ctx.organizationId, customerId, tagId);
  const { error } = await supabase
    .from('customer_tag_links')
    .insert({ customer_id: customerId, tag_id: tagId });
  if (error && error.code !== '23505') throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

/** 顧客からのタグ取り外し */
export async function detachCustomerTag(customerId: string, tagId: string) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  await assertOwnCustomerAndTag(supabase, ctx.organizationId, customerId, tagId);
  const { error } = await supabase
    .from('customer_tag_links')
    .delete()
    .eq('customer_id', customerId)
    .eq('tag_id', tagId);
  if (error) throw new Error(error.message);

  revalidatePath(`/app/customers/${customerId}`);
}

// -------------------------------------------------------------
// 重複候補・統合（v0.3 項目12）
// -------------------------------------------------------------

export interface MergeCandidateResult {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: string | null;
}

/** 電話番号での重複候補検索（顧客詳細の「この顧客と統合」用） */
export async function searchCustomersForMerge(phone: string, excludeId: string): Promise<MergeCandidateResult[]> {
  const ctx = await requirePermission('customers.delete');
  const trimmed = phone.trim().replace(/[%,()]/g, '');
  if (!trimmed) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('id, name, phone, email, visit_count, total_spent, last_visit_at')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .neq('id', excludeId)
    .ilike('phone', `%${trimmed}%`)
    .limit(20);

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    visitCount: c.visit_count,
    totalSpent: c.total_spent,
    lastVisitAt: c.last_visit_at,
  }));
}

/**
 * 重複顧客の統合。merge_customers RPC（migration 00016）を対象IDごとに順次呼び出す。
 * 予約・注文・ポイント・タグ等の引き継ぎと統合元の論理削除はRPC側で行われる。
 */
export async function mergeCustomers(keepId: string, mergeIds: string[]) {
  const ctx = await requirePermission('customers.delete');
  const targets = mergeIds.filter((id) => id !== keepId);
  if (targets.length === 0) throw new Error('統合対象がありません');

  const supabase = await createClient();
  const { data: owned } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .in('id', [keepId, ...targets]);
  if ((owned?.length ?? 0) !== targets.length + 1) {
    throw new Error('対象の顧客が見つかりません');
  }

  for (const mergeId of targets) {
    const { error } = await supabase.rpc('merge_customers', { p_keep_id: keepId, p_merge_id: mergeId });
    if (error) throw new Error(error.message);
  }

  revalidatePath('/app/customers');
  revalidatePath(`/app/customers/${keepId}`);
  for (const mergeId of targets) revalidatePath(`/app/customers/${mergeId}`);
}

// -------------------------------------------------------------
// ポイント・会員（v0.3 項目13）
// -------------------------------------------------------------

/** 会員番号の更新（組織内でユニーク。重複時はDB制約エラーを分かりやすく変換） */
export async function updateCustomerMemberNo(customerId: string, memberNo: string) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({ member_no: nullIfEmpty(memberNo), updated_by: ctx.userId })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (error) {
    if (error.code === '23505') throw new Error('この会員番号は既に他の顧客で使用されています');
    throw new Error(error.message);
  }
  revalidatePath(`/app/customers/${customerId}`);
}

/** 会員ランクの更新 */
export async function updateCustomerMemberRank(customerId: string, rank: string) {
  const ctx = await requirePermission('customers.write');
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({ member_rank: rank, updated_by: ctx.userId })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/app/customers/${customerId}`);
}

/**
 * ポイントの手動調整。point_transactions(kind='adjust') を記録し customers.point_balance を更新する。
 * 残高がマイナスになる調整は拒否する（テーブルのcheck制約と整合）。
 */
export async function adjustCustomerPoints(customerId: string, delta: number, reason: string) {
  const ctx = await requirePermission('cash.approve');
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('調整理由を入力してください');
  if (!Number.isFinite(delta) || delta === 0) throw new Error('増減ポイントを入力してください');

  const supabase = await createClient();
  const { data: customer, error: fetchError } = await supabase
    .from('customers')
    .select('point_balance')
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (fetchError || !customer) throw new Error('顧客が見つかりません');

  const nextBalance = customer.point_balance + delta;
  if (nextBalance < 0) throw new Error('ポイント残高が不足しています');

  const { error: updateError } = await supabase
    .from('customers')
    .update({ point_balance: nextBalance, updated_by: ctx.userId })
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId);
  if (updateError) throw new Error(updateError.message);

  const { error: txError } = await supabase.from('point_transactions').insert({
    organization_id: ctx.organizationId,
    store_id: ctx.currentStore?.id ?? null,
    customer_id: customerId,
    kind: 'adjust',
    points: delta,
    balance_after: nextBalance,
    note: trimmedReason,
    created_by: ctx.userId,
  });
  if (txError) throw new Error(txError.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: ctx.currentStore?.id ?? null,
    p_action: 'customer.points_adjust',
    p_target_table: 'customers',
    p_target_id: customerId,
    p_before: { point_balance: customer.point_balance },
    p_after: { point_balance: nextBalance, delta },
    p_note: trimmedReason,
  });

  revalidatePath(`/app/customers/${customerId}`);
}

// -------------------------------------------------------------
// 個人情報の匿名化（データ保護 PHASE6）
// -------------------------------------------------------------

/**
 * 顧客のPIIを匿名化する（org.settings権限が必要）。
 * 取引集計（visit_count/total_spent等）・予約/注文/ポイント履歴との紐付けは保持したまま、
 * 氏名・連絡先・住所・生年月日・自由記述メモ等の個人特定情報のみクリアする。
 * 既に匿名化済みの顧客は再実行できない。監査ログに理由を記録する。
 */
export async function anonymizeCustomer(customerId: string, reason: string) {
  const ctx = await requirePermission('org.settings');
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('匿名化の理由を入力してください');

  const supabase = await createClient();

  const { data: before } = await supabase
    .from('customers')
    .select('name, anonymized_at')
    .eq('id', customerId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!before) throw new Error('顧客が見つかりません');
  if (before.anonymized_at) throw new Error('この顧客は既に匿名化されています');

  await withErrorCapture(
    { route: 'customers.anonymize', organizationId: ctx.organizationId, userId: ctx.userId, detail: { customerId } },
    async () => {
      const { error } = await supabase
        .from('customers')
        .update({
          name: '匿名顧客',
          name_kana: null,
          phone: null,
          email: null,
          birthday: null,
          gender: null,
          postal_code: null,
          address: null,
          allergy_note: null,
          dislike_note: null,
          preference_note: null,
          seat_preference: null,
          anniversary_note: null,
          service_note: null,
          anonymized_at: new Date().toISOString(),
          updated_by: ctx.userId,
        })
        .eq('id', customerId)
        .eq('organization_id', ctx.organizationId);
      if (error) throw new Error(error.message);

      await supabase.rpc('log_audit', {
        p_org: ctx.organizationId,
        p_store: ctx.currentStore?.id ?? null,
        p_action: 'customer.anonymize',
        p_target_table: 'customers',
        p_target_id: customerId,
        p_before: { name: before.name },
        p_after: { name: '匿名顧客', anonymized: true },
        p_note: trimmedReason,
      });
    }
  );

  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath('/app/customers');
}
