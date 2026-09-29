'use server';

import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSteraPaymentType, methodOfPaymentType, steraSlipNumber } from '@/lib/stera';
import { expireStaleSteraRequests, REQUEST_COLUMNS, type SteraRequestRow } from '@/lib/stera-server';
import { checkout, type CheckoutPayment } from './actions';

/**
 * レジ（iPad）→ stera 端末の決済（2026-09-29 Ronnie「stera を押したら金額が端末へ、決済、会計、ドロア」）。
 * 流れ：startSteraPayment（依頼を作る）→ 画面が checkSteraPayment を2秒ごとに呼ぶ →
 * 端末で成功したら、ここで会計（checkout）を確定する → 画面がドロアを開く。
 *
 * 二重決済を防ぐ：
 *  - 1つの伝票で待っている依頼は1つだけ（DB の一意インデックス）
 *  - 端末が受け取った（sent）依頼は、レジからは取り消せない（端末で終えるか取り消す）
 *  - 成功したのに会計がまだの依頼があれば、新しく依頼せずにその会計を確定する
 */

export interface SteraPaymentState {
  ok: boolean;
  error?: string;
  requestId?: string;
  /** queued（端末が受け取る前）/ sent（端末で決済中）/ succeeded / failed / canceled / expired */
  status?: string;
  /** 会計まで確定した */
  finalized?: boolean;
  /** 確定した支払方法（ドロアの判定に使う） */
  method?: CheckoutPayment['method'];
  /** 支払方法の内訳（VISA・PayPay など） */
  brand?: string | null;
}

async function loadOrderForUser(orderId: string) {
  const ctx = await requirePermission('pos.checkout');
  const supabase = await createClient();
  const { data: order } = await supabase
    .from('orders')
    .select('id, store_id, organization_id, status, order_no, total, tax_total')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ctx, order: null as null };
  const allowed = ctx.isHq || ctx.stores.some((s) => s.id === order.store_id);
  return { ctx, order: allowed ? order : null };
}

/** 成功した依頼の会計を確定する（何度呼んでも同じ。会計済みなら finalized を付けるだけ） */
async function finalizeSucceeded(req: SteraRequestRow): Promise<SteraPaymentState> {
  const admin = createAdminClient();
  const result = (req.result ?? {}) as { method?: string | null; brand?: string | null };
  const method = (result.method as CheckoutPayment['method'] | null) ?? methodOfPaymentType(req.payment_type) ?? 'credit';
  const brand = result.brand ?? null;

  const outcome = await checkout(req.order_id, [{ method, amount: req.amount, provider: brand }]);
  if (!outcome.ok && !outcome.alreadyPaid) {
    if (outcome.registerClosed) {
      return {
        ok: false,
        requestId: req.id,
        status: 'succeeded',
        error:
          'stera の決済は完了しましたが、レジが未開局のため会計を確定できません。レジを開局してから、もう一度この画面で「stera で決済」を押してください / Paid on stera, but the register is not open.',
      };
    }
    return { ok: false, requestId: req.id, status: 'succeeded', error: '会計の確定に失敗しました。もう一度お試しください' };
  }
  await admin
    .from('stera_payment_requests')
    .update({ finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.id)
    .is('finalized_at', null);
  return { ok: true, requestId: req.id, status: 'succeeded', finalized: true, method, brand };
}

/** stera 端末へ決済を依頼する */
export async function startSteraPayment(orderId: string, terminalId: string, paymentType: string): Promise<SteraPaymentState> {
  if (!isSteraPaymentType(paymentType)) return { ok: false, error: '支払種別が正しくありません' };
  const { ctx, order } = await loadOrderForUser(orderId);
  if (!order) return { ok: false, error: '注文が見つかりません' };
  if (order.status !== 'open') return { ok: false, error: 'この注文は会計済みです' };

  const admin = createAdminClient();
  await expireStaleSteraRequests(admin, { orderId });

  // 成功したのに会計がまだ（画面を閉じた・通信が切れた）→ 新しく依頼せず会計を確定
  const { data: paidRows } = await admin
    .from('stera_payment_requests')
    .select(REQUEST_COLUMNS)
    .eq('order_id', orderId)
    .eq('status', 'succeeded')
    .is('finalized_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const paid = (paidRows ?? [])[0] as SteraRequestRow | undefined;
  if (paid) return finalizeSucceeded(paid);

  const { data: terminal } = await admin
    .from('stera_terminals')
    .select('id, store_id, organization_id, status')
    .eq('id', terminalId)
    .maybeSingle();
  if (!terminal || terminal.status !== 'active') return { ok: false, error: 'stera 端末が見つかりません（設定 > 決済・端末）' };
  if (terminal.store_id !== order.store_id) return { ok: false, error: 'この stera 端末は、この伝票の店舗のものではありません' };

  // 金額は最新の合計（割引・サービス料の変更を反映）
  const supabase = await createClient();
  await supabase.rpc('recalc_order_totals', { p_order_id: orderId });
  const { data: fresh } = await supabase.from('orders').select('total, tax_total').eq('id', orderId).maybeSingle();
  const amount = Number(fresh?.total ?? order.total ?? 0);
  const tax = Math.max(0, Math.min(9999999, Number(fresh?.tax_total ?? order.tax_total ?? 0)));
  if (!Number.isInteger(amount) || amount < 1 || amount > 99999999) return { ok: false, error: '決済金額が正しくありません' };

  // 同じ伝票で待っている依頼
  const { data: activeRows } = await admin
    .from('stera_payment_requests')
    .select(REQUEST_COLUMNS)
    .eq('order_id', orderId)
    .in('status', ['queued', 'sent'])
    .limit(1);
  const active = (activeRows ?? [])[0] as SteraRequestRow | undefined;
  if (active) {
    if (active.status === 'sent') {
      return { ok: true, requestId: active.id, status: 'sent' };
    }
    // 端末がまだ受け取っていない：同じ内容ならそのまま、違えば取り消して作り直す
    if (active.terminal_id === terminalId && active.amount === amount && active.payment_type === paymentType) {
      return { ok: true, requestId: active.id, status: 'queued' };
    }
    const { data: dropped } = await admin
      .from('stera_payment_requests')
      .update({ status: 'canceled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', active.id)
      .eq('status', 'queued')
      .select('id');
    if (!dropped?.length) return { ok: true, requestId: active.id, status: 'sent' };
  }

  const { data: created, error } = await admin
    .from('stera_payment_requests')
    .insert({
      organization_id: order.organization_id,
      store_id: order.store_id,
      terminal_id: terminalId,
      order_id: orderId,
      amount,
      tax,
      payment_type: paymentType,
      slip_number: steraSlipNumber(order.order_no as number | null),
      status: 'queued',
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !created) return { ok: false, error: `stera への依頼に失敗しました: ${error?.message ?? ''}` };
  return { ok: true, requestId: created.id as string, status: 'queued' };
}

/** 依頼の状態を見る。成功していれば会計を確定する */
export async function checkSteraPayment(requestId: string): Promise<SteraPaymentState> {
  const ctx = await requirePermission('pos.checkout');
  const admin = createAdminClient();
  const { data: row } = await admin.from('stera_payment_requests').select(REQUEST_COLUMNS).eq('id', requestId).maybeSingle();
  const req = row as SteraRequestRow | null;
  if (!req) return { ok: false, error: '決済の依頼が見つかりません' };
  if (!(ctx.isHq || ctx.stores.some((s) => s.id === req.store_id))) return { ok: false, error: 'この店舗の操作はできません' };

  if (req.status === 'queued') {
    await expireStaleSteraRequests(admin, { orderId: req.order_id });
    const { data: again } = await admin.from('stera_payment_requests').select('status').eq('id', req.id).maybeSingle();
    return { ok: true, requestId: req.id, status: (again?.status as string | undefined) ?? req.status };
  }
  if (req.status === 'succeeded') {
    if (req.finalized_at) {
      const result = (req.result ?? {}) as { method?: CheckoutPayment['method']; brand?: string | null };
      return { ok: true, requestId: req.id, status: 'succeeded', finalized: true, method: result.method ?? 'credit', brand: result.brand ?? null };
    }
    return finalizeSucceeded(req);
  }
  return { ok: true, requestId: req.id, status: req.status };
}

/**
 * 依頼をやめる。端末が受け取る前（queued）だけ。端末で決済中（sent）は端末で終えるか取り消してもらう。
 * force=true は、端末から結果が返ってこないとき（3分以上）だけ使う。あとから成功が届いた場合は、
 * 次に「stera で決済」を押したときにその会計を確定する（新しく決済しない）。
 */
export async function cancelSteraPayment(requestId: string, force = false): Promise<SteraPaymentState> {
  const ctx = await requirePermission('pos.checkout');
  const admin = createAdminClient();
  const { data: row } = await admin.from('stera_payment_requests').select(REQUEST_COLUMNS).eq('id', requestId).maybeSingle();
  const req = row as SteraRequestRow | null;
  if (!req) return { ok: false, error: '決済の依頼が見つかりません' };
  if (!(ctx.isHq || ctx.stores.some((s) => s.id === req.store_id))) return { ok: false, error: 'この店舗の操作はできません' };
  if (req.status === 'succeeded') return { ok: false, status: 'succeeded', error: '決済は完了しています（取り消しは stera 端末で行ってください）' };

  const allowed = req.status === 'queued' || (force && req.status === 'sent' && !!req.sent_at && Date.now() - Date.parse(req.sent_at) > 3 * 60 * 1000);
  if (req.status === 'sent' && !allowed) {
    return {
      ok: false,
      status: 'sent',
      error: 'stera 端末で決済中です。端末で決済を終えるか、端末の画面で取り消してください / Payment is in progress on the stera terminal.',
    };
  }
  if (!allowed) return { ok: true, status: req.status };
  await admin
    .from('stera_payment_requests')
    .update({ status: 'canceled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.id)
    .in('status', ['queued', 'sent']);
  return { ok: true, requestId: req.id, status: 'canceled' };
}
