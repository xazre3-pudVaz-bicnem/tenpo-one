'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { addItem } from '../pos/actions';
import { MAX_LINE_QUANTITY } from '@/components/handy/logic';

/**
 * お客様QRからの呼び出しを「対応済み」にする。
 * 自組織かつアクセス可能な店舗の、まだ未対応（open）の行だけを更新する
 * （他の端末が先に対応済みにしていた場合は黙って成功扱いにせず、その旨を返す）。
 */
export async function resolveServiceCall(callId: string): Promise<{ alreadyResolved: boolean }> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  const { data: call } = await supabase
    .from('service_calls')
    .select('id, organization_id, store_id, table_id, kind, status')
    .eq('id', callId)
    .maybeSingle();
  if (!call) throw new Error('呼び出しが見つかりません');
  if (call.organization_id !== ctx.organizationId) throw new Error('この呼び出しは操作できません');
  await assertStoreAccess(ctx, call.store_id);

  if (call.status !== 'open') {
    revalidatePath('/handy');
    return { alreadyResolved: true };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('service_calls')
    .update({ status: 'done', resolved_at: now, resolved_by: ctx.userId })
    .eq('id', callId)
    // 他端末と同時に押された場合に二重更新しない
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(error.message);

  if (!updated || updated.length === 0) {
    revalidatePath('/handy');
    return { alreadyResolved: true };
  }

  await supabase.rpc('log_audit', {
    p_org: call.organization_id,
    p_store: call.store_id,
    p_action: 'service_call.resolve',
    p_target_table: 'service_calls',
    p_target_id: callId,
    p_before: { status: 'open', kind: call.kind },
    p_after: { status: 'done', resolved_at: now },
    p_note: call.kind === 'checkout' ? 'お会計希望に対応' : 'スタッフ呼び出しに対応',
  });

  revalidatePath('/handy');
  revalidatePath('/app/floor');
  return { alreadyResolved: false };
}

export interface HandyOrderLineInput {
  menuItemId: string;
  optionItemIds: string[];
  quantity: number;
  /** エラー文面に出す商品名（保存はサーバー側でDBの名前を使う） */
  name: string;
}

export interface HandySubmitResult {
  /** 実際に伝票へ追加できた点数 */
  sentQuantity: number;
  /** 送信できずカートに残す行（失敗時は途中の行も残る） */
  remaining: HandyOrderLineInput[];
  /** 失敗した理由。null なら全件送信できた */
  message: string | null;
}

/**
 * ハンディのカートを伝票へ送信する。
 * 既存のPOSサーバーアクション（addItem）をそのまま呼ぶ（価格・税率・選択肢の検証はPOS側と同一）。
 * addItem は1回で1点を追加するため、数量ぶん繰り返す（POSで商品を複数回タップした場合と同じ結果）。
 *
 * 途中で失敗したら、そこで中断して「送信できた点数」と「カートに残す行」を返す。
 * 呼び出し側は残った行をカートに戻すこと（成功したように見せない）。
 */
export async function submitHandyOrder(
  orderId: string,
  lines: HandyOrderLineInput[]
): Promise<HandySubmitResult> {
  const ctx = await requirePermission('pos.order');
  const supabase = await createClient();

  if (lines.length === 0) throw new Error('注文する商品がありません');
  if (lines.length > 50) throw new Error('一度に送信できる商品は50種類までです');
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      throw new Error(`数量は1〜${MAX_LINE_QUANTITY}で指定してください`);
    }
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) throw new Error('注文が見つかりません');
  await assertStoreAccess(ctx, order.store_id);
  if (order.status !== 'open') throw new Error('この注文は既に会計済み・取消済みです');

  // 1行＝1回の追加（数量ぶんまとめて1明細にする）。1個ずつ呼ぶと数量×往復になり、
  // 伝票と厨房伝票にも同じ商品が数量ぶん別行で並んでしまう
  let sentQuantity = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      await addItem(orderId, line.menuItemId, line.optionItemIds, line.quantity);
      sentQuantity += line.quantity;
    } catch (e) {
      const reason = e instanceof Error ? e.message : '送信に失敗しました';
      revalidatePath('/handy');
      return {
        sentQuantity,
        remaining: lines.slice(i),
        message: `「${line.name}」で中断しました：${reason}`,
      };
    }
  }

  revalidatePath('/handy');
  return { sentQuantity, remaining: [], message: null };
}
