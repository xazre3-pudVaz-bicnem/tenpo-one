import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { setSeatTime } from '@/app/app/pos/actions';
import { setOrderVisitSource } from '@/lib/native-pos-server';
import { visitMemo, visitSourceByLabel } from '@/lib/handy-visit';
import { visitFromMemo, type NativeVisitEdit } from '@/lib/native-visit-edit';

/** 伝票メモの頭（来店登録で入れたメモか。手で書いたメモは書き直さない） */
const VISIT_MEMO_PREFIX = 'ハンディ: ';

async function loadOrderMemo(ctx: SessionContext, orderId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('orders').select('id, store_id, status, memo').eq('id', orderId).maybeSingle();
  if (!data || !(ctx.isHq || ctx.stores.some((s) => s.id === data.store_id))) return null;
  return { supabase, status: data.status as string, memo: (data.memo as string | null) ?? null };
}

/** 直す画面の最初の値（伝票メモから男女・来店経路・時間制・終了前注意。読めなければ null） */
export async function loadVisitEdit(ctx: SessionContext, orderId: string) {
  const row = await loadOrderMemo(ctx, orderId);
  if (!row) return { ok: false as const, error: '注文が見つかりません' };
  return { ok: true as const, visit: visitFromMemo(row.memo) };
}

/**
 * 保存：開始・時間・人数・モード・プラン・コースは Web と同じ setSeatTime、来店経路は setOrderVisitSource、
 * 伝票メモは来店登録と同じ visitMemo で書き直す（来店登録で入れたメモ・空のメモのときだけ）
 */
export async function saveVisitEdit(ctx: SessionContext, a: NativeVisitEdit): Promise<{ ok: boolean; error?: string }> {
  const d = a.draft;
  await setSeatTime(a.orderId, {
    startTime: d.startTime,
    durationMinutes: d.timed ? d.duration : null,
    courseId: a.courseId,
    guestCount: d.male + d.female,
    plans: d.plans,
    planItemIds: d.planItemIds,
  });
  // 来店経路はこの画面では出さない（会計で選ぶ）。経路が渡されたときだけ変える（空なら今のまま）
  const src = d.source ? visitSourceByLabel(d.source) : null;
  if (src) {
    const visit = await setOrderVisitSource(ctx, a.orderId, src.id);
    if (!visit.ok) return { ok: false, error: visit.error ?? '来店経路を保存できませんでした' };
  }

  const row = await loadOrderMemo(ctx, a.orderId);
  if (row && row.status === 'open' && (!row.memo || row.memo.startsWith(VISIT_MEMO_PREFIX))) {
    const { error } = await row.supabase
      .from('orders')
      .update({ memo: visitMemo(d), updated_by: ctx.userId })
      .eq('id', a.orderId)
      .eq('status', 'open');
    if (error) return { ok: false, error: 'お客様情報のメモを保存できませんでした' };
  }
  return { ok: true };
}
