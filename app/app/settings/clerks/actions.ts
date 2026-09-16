'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

function assertStoreAccess(storeIds: string[], storeId: string): string | null {
  return storeIds.includes(storeId) ? null : '対象店舗にアクセス権がありません';
}

/** POS担当者を追加する（アカウントは作らず、名前だけを店舗の台帳に登録する） */
export async function addPosClerk(storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const trimmed = name.trim();
  if (!trimmed) return { error: '担当者名を入力してください' };
  if (trimmed.length > 50) return { error: '担当者名は50文字以内で入力してください' };

  const supabase = await createClient();
  // 表示順は末尾に採番する（既存の並びを崩さない）
  const { count } = await supabase
    .from('pos_clerks')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId);

  const { error } = await supabase.from('pos_clerks').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    name: trimmed,
    sort_order: count ?? 0,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'この担当者名は既に登録されています' };
    }
    return { error: `担当者の追加に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.clerks.add',
    p_target_table: 'pos_clerks',
    p_target_id: null,
    p_before: null,
    p_after: { name: trimmed },
    p_note: null,
  });

  revalidatePath('/app/settings/clerks');
  return {};
}

/** 担当者名を変更する（過去の伝票は発行時点の名前を保持するため影響しない） */
export async function renamePosClerk(id: string, storeId: string, name: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const trimmed = name.trim();
  if (!trimmed) return { error: '担当者名を入力してください' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('pos_clerks')
    .update({ name: trimmed, updated_by: ctx.userId })
    .eq('id', id)
    .eq('store_id', storeId);
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'この担当者名は既に登録されています' };
    }
    return { error: `変更に失敗しました: ${error.message}` };
  }

  revalidatePath('/app/settings/clerks');
  return {};
}

/** 選択肢への表示/非表示を切り替える（削除はしない＝過去伝票の参照を壊さない） */
export async function setPosClerkStatus(
  id: string,
  storeId: string,
  status: 'active' | 'hidden'
): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('pos_clerks')
    .update({ status, updated_by: ctx.userId })
    .eq('id', id)
    .eq('store_id', storeId);
  if (error) return { error: `変更に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: status === 'hidden' ? 'settings.clerks.hide' : 'settings.clerks.show',
    p_target_table: 'pos_clerks',
    p_target_id: id,
    p_before: null,
    p_after: { status },
    p_note: null,
  });

  revalidatePath('/app/settings/clerks');
  return {};
}
