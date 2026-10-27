import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { addCustomPriceItem, addItem, cancelItem, checkout, clearTable } from '@/app/app/pos/actions';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { setOrderVisitSource } from '@/lib/native-pos-server';
import { visitGuestCount, visitMemo, visitSourceByLabel } from '@/lib/handy-visit';
import { offlineCashPayments, offlineRoundingAllowed, type OfflineSyncOrder } from '@/lib/native-offline-sync';

type Admin = ReturnType<typeof createAdminClient>;

/** 同期の記録（audit_logs。DB の列を足さずに「もう入れたか」「いま誰が入れているか」を覚える） */
const TARGET = 'native_offline';
/**
 * 1つの伝票を入れている通信の札（この時間を過ぎたら、止まったとみなして次の通信が入れてよい）。
 * Vercel の関数がいちばん長く動ける時間（300秒）より長くする（まだ動いている通信と重ならない）
 */
const LEASE_MS = 6 * 60 * 1000;
/** 何度送っても成功しない（人が直す）エラー */
const PERMANENT = /見つかりません|承認|理由を入力|支払記録|権限|アクセス権/;

export type OfflineSyncResult =
  | { ok: true; orderId: string; warnings: string[] }
  | { ok: false; error: string; orderId?: string; retry: boolean };

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

class SyncStop extends Error {
  constructor(message: string, readonly retry: boolean) {
    super(message);
  }
}

type Recall = (step: string) => Promise<Record<string, unknown> | null>;
type Remember = (step: string, after: Record<string, unknown>) => Promise<void>;

/**
 * オフラインで受けた1つの伝票をサーバーに入れる（何度呼んでも二重にならない）。
 *   0. 札：同じ伝票を2つの通信が同時に入れないよう、audit_logs に札を出して一番先の札だけが進む
 *   1. 伝票：オフラインで始めた伝票は、その卓に新しい伝票を作る（開始時刻はオフラインの時刻。startWalkIn は使わない：
 *      卓が空席でない・残っている伝票に混ざる、を避ける）
 *   2. 品：Web と同じ addItem（選択肢・税）で入れたら、すぐ「入れた」を覚えてから、単価をオフラインで出した値段・
 *      厨房へ送った・印刷済み・提供済みにする（厨房伝票は iPad がもう出したので claim_kitchen_items にもう一度出させない）
 *   3. 取消・テーブルクリア：cancelItem / clearTable（取消の時刻はそのとき。紙は出さない）
 *   4. 会計：iPad で受け取った金額と合計が少しだけ違えば端数調整、大きく違えば人が見る → checkout（現金・レシートは出さない）
 *      → 会計の時刻をオフラインの時刻に直す
 * 1段ずつ audit_logs に記録し、途中で止まっても次は続きから。入れられなかったもの（ほかの端末で会計済みなど）は
 * 成功にせず、人が見る（retry:false）。
 */
export async function syncOfflineOrder(ctx: SessionContext, input: OfflineSyncOrder): Promise<OfflineSyncResult> {
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === input.storeId)) return { ok: false, error: '店舗がありません', retry: false };
  const admin = createAdminClient();
  const warnings: string[] = [];
  const key = (step: string) => `${input.clientId}:${step}`;

  const recall: Recall = async (step) => {
    const { data, error } = await admin
      .from('audit_logs')
      .select('after_data')
      .eq('target_table', TARGET)
      .eq('target_id', key(step))
      .eq('organization_id', ctx.organizationId!)
      .eq('store_id', input.storeId)
      .limit(1)
      .maybeSingle();
    if (error) throw new SyncStop(`記録を読めませんでした：${error.message}`, true);
    return (data as { after_data: Record<string, unknown> | null } | null)?.after_data ?? (data ? {} : null);
  };
  const remember: Remember = async (step, after) => {
    const { error } = await admin.from('audit_logs').insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      actor_id: ctx.userId,
      actor_role: ctx.role,
      action: 'native.offline',
      target_table: TARGET,
      target_id: key(step),
      after_data: after,
      note: input.localNo ? `オフライン伝票 ${input.localNo}` : 'オフライン',
    });
    // 覚えられなかったら先へ進まない（次に同じことをもう一度しないため）
    if (error) throw new SyncStop(`記録を残せませんでした：${error.message}`, true);
  };

  // 0. 札（出してから確かめる。同時に来たら一番先の札だけが進む）
  const leaseId = randomUUID();
  try {
    await remember('lease', { leaseId });
    const since = new Date(Date.now() - LEASE_MS).toISOString();
    const [{ data: leases }, { data: released }] = await Promise.all([
      admin.from('audit_logs').select('id, created_at, after_data').eq('target_table', TARGET).eq('target_id', key('lease'))
        .eq('organization_id', ctx.organizationId!).gte('created_at', since).order('created_at').order('id'),
      admin.from('audit_logs').select('after_data').eq('target_table', TARGET).eq('target_id', key('lease-done'))
        .eq('organization_id', ctx.organizationId!).gte('created_at', since),
    ]);
    const done = new Set(((released ?? []) as { after_data: { leaseId?: string } | null }[]).map((r) => r.after_data?.leaseId));
    const active = ((leases ?? []) as { after_data: { leaseId?: string } | null }[]).filter((l) => !done.has(l.after_data?.leaseId));
    if (active[0]?.after_data?.leaseId !== leaseId) {
      await releaseLease(admin, ctx, input, key('lease-done'), leaseId);
      return { ok: false, error: 'この伝票はいま別の通信で入れています。少し待ってからもう一度送ります', retry: true };
    }
  } catch (e) {
    return { ok: false, error: errorText(e, '同期を始められませんでした'), retry: true };
  }

  try {
    return await applyOrder(ctx, admin, input, warnings, recall, remember);
  } catch (e) {
    if (e instanceof SyncStop) return { ok: false, error: e.message, retry: e.retry };
    return { ok: false, error: errorText(e, 'オフラインの伝票を入れられませんでした'), retry: true };
  } finally {
    await releaseLease(admin, ctx, input, key('lease-done'), leaseId);
  }
}

async function releaseLease(admin: Admin, ctx: SessionContext, input: OfflineSyncOrder, targetId: string, leaseId: string) {
  await admin.from('audit_logs').insert({
    organization_id: ctx.organizationId, store_id: input.storeId, actor_id: ctx.userId, actor_role: ctx.role,
    action: 'native.offline', target_table: TARGET, target_id: targetId, after_data: { leaseId },
  });
}

async function applyOrder(
  ctx: SessionContext,
  admin: Admin,
  input: OfflineSyncOrder,
  warnings: string[],
  recall: Recall,
  remember: Remember
): Promise<OfflineSyncResult> {
  // 1. 伝票
  let orderId = input.serverOrderId;
  if (!orderId) {
    const done = await recall('order');
    orderId = typeof done?.orderId === 'string' ? done.orderId : null;
    if (!orderId) {
      orderId = await createOfflineOrder(ctx, input);
      await remember('order', { orderId, tableId: input.tableId, localNo: input.localNo });
    }
    // 来店登録で選んだプラン商品（まだ厨房へ送っていないもの）は、Web の来店登録と同じく未送信の品として入れる
    if (input.planItemIds.length && !(await recall('plans'))) {
      for (const id of input.planItemIds) {
        try {
          await addItem(orderId, id, [], 1);
        } catch (e) {
          warnings.push(`プラン商品を入れられませんでした：${errorText(e, '')}`);
        }
      }
      await remember('plans', { planItemIds: input.planItemIds });
    }
  }
  const { data: orderRow } = await admin.from('orders').select('id, store_id, organization_id, status, total').eq('id', orderId).maybeSingle();
  const order = orderRow as { id: string; store_id: string; organization_id: string; status: string; total: number } | null;
  if (!order || order.organization_id !== ctx.organizationId || order.store_id !== input.storeId) {
    throw new SyncStop('伝票が見つかりません', false);
  }
  const open = order.status === 'open';

  if (open && input.clerkId && !(await recall('clerk'))) {
    const r = await setOrderClerk(orderId, input.clerkId);
    if (!r.ok) warnings.push(r.error ?? '担当者を入れられませんでした');
    await remember('clerk', { clerkId: input.clerkId });
  }

  // 2. 品
  const cancelledClient = new Set(input.cancels.flatMap((c) => (c.ref.kind === 'client' ? [c.ref.clientLineId] : [])));
  const lineIds = new Map<string, string>();
  const skipped = new Set<string>();
  for (const l of input.lines) {
    const done = await recall(`line:${l.clientLineId}`);
    if (done?.skipped) {
      skipped.add(l.clientLineId);
      continue;
    }
    let itemId: string | null = typeof done?.orderItemId === 'string' ? done.orderItemId : null;
    if (!itemId) {
      if (!open) throw new SyncStop('この伝票はもう会計・取消されています（ほかの端末）。オフラインで入れた品を入れられません', false);
      try {
        itemId = l.custom
          ? (await addCustomPriceItem(orderId, { categoryId: l.custom.categoryId, price: l.custom.price, memo: l.custom.memo, quantity: l.quantity })).id
          : (await addItem(orderId, l.menuItemId!, l.optionItemIds, l.quantity, l.openPrice)).id;
      } catch (e) {
        // 売り切れ・メニューから外れた品でも、お客様に出した品なので入れる（名前・税は商品から）
        itemId = await insertServedItem(admin, ctx, order, l.menuItemId, l.quantity, l.unitPrice, l.at);
        if (!itemId) {
          if (cancelledClient.has(l.clientLineId)) {
            // オフラインで取り消した品は入れなくても合計は同じ
            await remember(`line:${l.clientLineId}`, { skipped: true });
            skipped.add(l.clientLineId);
            continue;
          }
          throw new SyncStop(`品を入れられませんでした：${errorText(e, '商品が見つかりません')}`, false);
        }
        warnings.push(`「${errorText(e, '')}」の品もそのまま入れました`);
      }
      if (!itemId) throw new SyncStop('品を入れられませんでした', true);
      // 入れたことを先に覚える（このあと止まっても、次は入れ直さずに続きから）
      await remember(`line:${l.clientLineId}`, { orderItemId: itemId, unitPrice: l.unitPrice, quantity: l.quantity });
    }
    lineIds.set(l.clientLineId, itemId);
    // 直しは1回だけ（そのあとほかの端末で数を変えた・分けた品を、送り直しで戻さない）
    if (!open || (await recall(`fix:${l.clientLineId}`))) continue;
    // 単価はオフラインで出した値段、厨房へ送った・印刷済み・提供済み（iPad がもう出した）を1回で
    const { error } = await admin
      .from('order_items')
      .update({ unit_price: l.unitPrice, line_total: l.unitPrice * l.quantity, kitchen_sent_at: l.at, kitchen_printed_qty: l.quantity, kitchen_status: 'served' })
      .eq('id', itemId)
      .eq('order_id', orderId)
      .eq('status', 'active');
    if (error) throw new SyncStop(`品を入れられませんでした：${error.message}`, true);
    // 注文の時刻はオフラインで入れたとき（売上の時間帯。直せなくても続ける）
    const { error: atError } = await admin.from('order_items').update({ created_at: l.at }).eq('id', itemId);
    if (atError) console.error('[offline-sync] created_at not fixed', itemId, atError.message);
    await remember(`fix:${l.clientLineId}`, { orderItemId: itemId });
  }
  if (open && input.lines.length) await admin.rpc('recalc_order_totals', { p_order_id: orderId });

  // 3. 取消
  for (const c of input.cancels) {
    if (c.ref.kind === 'client' && skipped.has(c.ref.clientLineId)) continue;
    const refKey = c.ref.kind === 'server' ? `cancel:${c.ref.lineId}` : `cancel:c:${c.ref.clientLineId}`;
    if (await recall(refKey)) continue;
    const lineId = c.ref.kind === 'server' ? c.ref.lineId : lineIds.get(c.ref.clientLineId);
    if (!lineId) {
      warnings.push('取消した品が見つかりませんでした');
      continue;
    }
    try {
      await cancelItem(orderId, lineId, c.reason, c.approvedByClerkId, { offlineAt: c.at });
    } catch (e) {
      const msg = errorText(e, '');
      // もう取消済み → 入れ済みとみなす。伝票が閉じている → 人が見る
      if (/会計済み・取消済み/.test(msg)) throw new SyncStop('この伝票はもう会計・取消されています（ほかの端末）。オフラインの取消を入れられません', false);
      if (!/既に取消済み/.test(msg)) throw new SyncStop(`取消を入れられませんでした：${msg}`, !PERMANENT.test(msg));
    }
    await remember(refKey, { orderItemId: lineId });
  }

  if (open && input.visitSourceId && !(await recall('visit'))) {
    const r = await setOrderVisitSource(ctx, orderId, input.visitSourceId);
    if (!r.ok) warnings.push(r.error ?? '来店経路を入れられませんでした');
    await remember('visit', { visitSourceId: input.visitSourceId });
  }

  // テーブルクリア
  if (input.cleared && !(await recall('clear'))) {
    try {
      await clearTable(orderId, input.cleared.reason, input.cleared.approvedByClerkId, { offlineAt: input.cleared.at });
    } catch (e) {
      const msg = errorText(e, '');
      if (!/会計済み・取消済み/.test(msg)) throw new SyncStop(`テーブルクリアを入れられませんでした：${msg}`, !PERMANENT.test(msg));
      warnings.push('この卓はもうほかの端末で閉じていました');
    }
    await remember('clear', { at: input.cleared.at });
  }

  // 4. 会計
  if (input.checkout && !(await recall('checkout'))) {
    const { data: fresh } = await admin.from('orders').select('status, total, rounding_adjustment').eq('id', orderId).maybeSingle();
    const now = fresh as { status: string; total: number; rounding_adjustment: number | null } | null;
    if (now?.status === 'paid' && (await recall('checkout-start'))) {
      // 前の通信で会計まで済んで、記録だけ残せなかった
      await remember('checkout', { at: input.checkout.at, total: input.checkout.total });
      return { ok: true, orderId, warnings };
    }
    if (now?.status !== 'open') {
      // ほかの端末で会計・取消された伝票：オフラインで受け取った現金を入れられない → 人が見る
      throw new SyncStop(`この伝票はもう会計・取消されています（ほかの端末）。オフラインの現金会計 ¥${input.checkout.total.toLocaleString('ja-JP')} を確かめてください`, false);
    }
    let serverTotal = Number(now.total);
    if (serverTotal !== input.checkout.total) {
      // iPad で受け取った金額を正にする（少しの差だけ。税の端数・時間帯の値段のずれ）。大きく違えば人が見る
      const diff = input.checkout.total - serverTotal;
      if (!offlineRoundingAllowed(serverTotal, input.checkout.total)) {
        throw new SyncStop(`合計が合いません（サーバー ¥${serverTotal.toLocaleString('ja-JP')}・iPad ¥${input.checkout.total.toLocaleString('ja-JP')}）。伝票を確かめてください`, false);
      }
      const { error: rErr } = await admin.from('orders').update({ rounding_adjustment: Number(now.rounding_adjustment ?? 0) + diff }).eq('id', orderId);
      if (rErr) throw new SyncStop(`合計を合わせられませんでした：${rErr.message}`, true);
      await admin.rpc('recalc_order_totals', { p_order_id: orderId });
      await remember('rounding', { serverTotal, ipadTotal: input.checkout.total, diff });
      warnings.push(`合計をiPadの金額に合わせました（端数調整 ${diff > 0 ? '+' : ''}¥${diff.toLocaleString('ja-JP')}）`);
      serverTotal = input.checkout.total;
    }
    const payments = offlineCashPayments(serverTotal, input.checkout);
    if (!payments) throw new SyncStop('お預かり金額が会計金額より少ないため入れられません', false);
    const memo = [input.checkout.memo, `オフライン会計${input.localNo ? ` ${input.localNo}` : ''}`].filter(Boolean).join(' / ');
    await remember('checkout-start', { at: input.checkout.at });
    let outcome;
    try {
      outcome = await checkout(orderId, payments, memo, undefined, { skipReceipt: true });
    } catch (e) {
      const msg = errorText(e, '');
      throw new SyncStop(`会計を入れられませんでした：${msg}`, !PERMANENT.test(msg));
    }
    if (outcome.registerClosed) throw new SyncStop('レジが開いていません。レジを開けると自動で入ります', true);
    if (outcome.alreadyPaid) throw new SyncStop('この伝票はもう会計されています（ほかの端末）。オフラインの現金会計を確かめてください', false);
    // 会計の時刻はオフラインで会計したとき（営業日は開いているレジの日）
    const at = input.checkout.at;
    await admin.from('orders').update({ closed_at: at }).eq('id', orderId);
    await admin.from('payments').update({ paid_at: at }).eq('order_id', orderId);
    await remember('checkout', { at, total: input.checkout.total });
  }

  return { ok: true, orderId, warnings };
}

/**
 * オフラインで始めた卓の伝票を作る（startWalkIn と同じ形：ウォークインの予約＋伝票。ただし卓が空席かは見ない・
 * 残っている伝票にも混ぜない。お客様はもう座っていて、iPad で会計まで済んでいることもあるため）
 */
async function createOfflineOrder(ctx: SessionContext, input: OfflineSyncOrder): Promise<string> {
  const supabase = await createClient();
  const draft = input.draft!;
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, organization_id, store_id')
    .eq('id', input.tableId!)
    .maybeSingle();
  const t = table as { id: string; organization_id: string; store_id: string } | null;
  if (!t || t.organization_id !== ctx.organizationId || t.store_id !== input.storeId) throw new SyncStop('卓が見つかりません', false);
  const { data: settings } = await supabase.from('store_settings').select('default_stay_minutes').eq('store_id', t.store_id).maybeSingle();
  const stay = draft.timed && draft.duration >= 15 && draft.duration <= 480
    ? draft.duration
    : ((settings as { default_stay_minutes?: number } | null)?.default_stay_minutes ?? 120);
  const startAt = new Date(input.openedAt ?? Date.now());
  const endAt = new Date(startAt.getTime() + stay * 60_000);
  const guests = Math.max(1, visitGuestCount(draft));

  // 前の通信で作れていたら、それを使う（伝票・予約の id は iPad の伝票の id。二重に作らない）
  const { data: existing } = await supabase.from('orders').select('id').eq('id', input.clientId).maybeSingle();
  if (existing) return input.clientId;

  let sourceId: string | null = null;
  const visitSource = draft.source ? visitSourceByLabel(draft.source) : null;
  if (visitSource) {
    const { data: src } = await supabase
      .from('reservation_sources')
      .select('id')
      .in('code', visitSource.codes as string[])
      .eq('status', 'active')
      .or(`organization_id.is.null,organization_id.eq.${t.organization_id}`)
      .limit(1)
      .maybeSingle();
    sourceId = (src as { id?: string } | null)?.id ?? null;
  }

  const { data: oldResv } = await supabase.from('reservations').select('id').eq('id', input.clientId).maybeSingle();
  let reservationId: string | null = oldResv ? input.clientId : null;
  for (let attempt = 0; attempt < 3 && !reservationId; attempt++) {
    const { data, error } = await supabase
      .from('reservations')
      .insert({
        id: input.clientId,
        organization_id: t.organization_id,
        store_id: t.store_id,
        code: `WI-${Math.floor(100000 + Math.random() * 900000)}`,
        reserved_date: startAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        party_size: guests,
        adults: guests,
        children: 0,
        guest_name: 'ウォークイン',
        guest_phone: '-',
        status: 'seated',
        created_via: 'walk_in',
        consent_accepted: true,
        created_by: ctx.userId,
        ...(draft.source ? { purpose: draft.source.slice(0, 60) } : {}),
        ...(sourceId ? { source_id: sourceId } : {}),
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505' && /pkey/.test(error.message)) {
        reservationId = input.clientId;
        break;
      }
      if (error.code === '23505') continue;
      throw new SyncStop(`伝票を作れませんでした：${error.message}`, true);
    }
    reservationId = (data as { id: string }).id;
  }
  if (!reservationId) throw new SyncStop('伝票を作れませんでした（予約コード）', true);
  const { data: link } = await supabase.from('reservation_tables').select('reservation_id').eq('reservation_id', reservationId).eq('table_id', t.id).maybeSingle();
  if (!link) await supabase.from('reservation_tables').insert({ reservation_id: reservationId, table_id: t.id });

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      id: input.clientId,
      organization_id: t.organization_id,
      store_id: t.store_id,
      reservation_id: reservationId,
      table_id: t.id,
      order_type: draft.plans.includes('course') ? 'course' : 'dine_in',
      status: 'open',
      guest_count: guests,
      staff_id: ctx.userId,
      created_by: ctx.userId,
      memo: visitMemo(draft).slice(0, 200),
      opened_at: startAt.toISOString(),
    })
    .select('id')
    .single();
  if (error?.code === '23505') return input.clientId;
  if (error || !order) throw new SyncStop(`伝票を作れませんでした：${error?.message ?? ''}`, true);
  // 卓は着席中に（まだ食べているお客様の卓を、空席として案内・移動先にしない。startWalkIn と同じ）
  await supabase.from('restaurant_tables').update({ current_status: 'seated' }).eq('id', t.id);
  return (order as { id: string }).id;
}

/**
 * addItem が受けない品（売り切れ・メニューから外れた）を、お客様に出した品としてそのまま入れる。
 * 商品はこの会社・この店のものだけ（名前・税は商品から、単価はオフラインで出した値段）。
 * 厨房へ送った・印刷済み・提供済みで入れる（厨房伝票を二重に出さない）
 */
async function insertServedItem(
  admin: Admin,
  ctx: SessionContext,
  order: { id: string; store_id: string; organization_id: string },
  menuItemId: string | null,
  quantity: number,
  unitPrice: number,
  at: string
): Promise<string | null> {
  if (!menuItemId) return null;
  const { data: item } = await admin
    .from('menu_items')
    .select('id, name, organization_id, store_id, tax_rates(rate, is_inclusive)')
    .eq('id', menuItemId)
    .maybeSingle();
  const m = item as { id: string; name: string; organization_id: string; store_id: string | null; tax_rates: unknown } | null;
  if (!m || m.organization_id !== order.organization_id || (m.store_id && m.store_id !== order.store_id)) return null;
  const taxRow = (Array.isArray(m.tax_rates) ? m.tax_rates[0] : m.tax_rates) as { rate: number; is_inclusive: boolean } | null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('order_items')
    .insert({
      organization_id: order.organization_id,
      store_id: order.store_id,
      order_id: order.id,
      menu_item_id: m.id,
      name: m.name,
      unit_price: unitPrice,
      quantity,
      tax_rate: taxRow?.rate ?? 10,
      tax_included: taxRow?.is_inclusive ?? true,
      line_total: unitPrice * quantity,
      modifiers: [],
      staff_id: ctx.userId,
      status: 'active',
      created_by: ctx.userId,
      kitchen_sent_at: at,
      kitchen_printed_qty: quantity,
      kitchen_status: 'served',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[offline-sync] served item insert failed', error.message);
    return null;
  }
  return (data as { id: string }).id;
}
