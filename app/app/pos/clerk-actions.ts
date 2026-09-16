'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface SetOrderClerkResult {
  ok: boolean;
  error?: string;
  clerkName?: string | null;
}

/**
 * 伝票の担当者を設定する。
 * clerk_name は設定時点の名前をスナップショットとして保存し、後から担当者名を変更・非表示にしても
 * その伝票・レシートの担当表示が変わらないようにする。
 */
export async function setOrderClerk(orderId: string, clerkId: string | null): Promise<SetOrderClerkResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, status')
    .eq('id', orderId)
    .single();
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id)) {
    return { ok: false, error: 'この店舗へのアクセス権がありません' };
  }
  if (order.status !== 'open') return { ok: false, error: 'この注文は既に会計済みです' };

  if (!clerkId) {
    const { error } = await supabase
      .from('orders')
      .update({ clerk_id: null, clerk_name: null })
      .eq('id', orderId);
    if (error) return { ok: false, error: `担当者の設定に失敗しました: ${error.message}` };
    revalidatePath('/app/pos');
    return { ok: true, clerkName: null };
  }

  // 担当者は同一店舗の有効な行のみ受け付ける（他店舗の担当者を指定できないようにする）
  const { data: clerk } = await supabase
    .from('pos_clerks')
    .select('id, name')
    .eq('id', clerkId)
    .eq('store_id', order.store_id)
    .eq('status', 'active')
    .maybeSingle();
  if (!clerk) return { ok: false, error: '担当者が見つかりません' };

  const { error } = await supabase
    .from('orders')
    .update({ clerk_id: clerk.id, clerk_name: clerk.name })
    .eq('id', orderId);
  if (error) return { ok: false, error: `担当者の設定に失敗しました: ${error.message}` };

  revalidatePath('/app/pos');
  return { ok: true, clerkName: clerk.name };
}
