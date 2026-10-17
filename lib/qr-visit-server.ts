/**
 * お客様QRの最初の画面（ご来店の人数）のサーバー側。
 * - qrStartRequired: その卓にまだ伝票（未会計の注文）が無いか（無ければ人数の画面を出す）
 * - startQrVisit: 人数を受けて伝票を開き、卓を「着席」にする（create_qr_order が最初の注文で開くのと同じ形）
 *
 * お客様は匿名なので、卓の QR（店の slug＋卓の token）が合っているときだけ動く。
 * 女性・男性の内訳は orders.guest_female / guest_male に入れる（列がまだ無いデータベースでは入れずに進む）。
 * 内訳は操作履歴にも残す。
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { qrGuestLabel, type QrGuestCounts } from '@/lib/qr-visit';

type Admin = ReturnType<typeof createAdminClient>;

interface QrTableRow {
  id: string;
  store_id: string;
  organization_id: string;
}

async function findQrTable(admin: Admin, slug: string, token: string): Promise<QrTableRow | null> {
  const { data: table } = await admin
    .from('restaurant_tables')
    .select('id, store_id, organization_id, stores!inner(slug)')
    .eq('qr_token', token)
    .eq('stores.slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (!table) return null;
  return { id: table.id as string, store_id: table.store_id as string, organization_id: table.organization_id as string };
}

async function openOrderOf(admin: Admin, tableId: string): Promise<{ id: string } | null> {
  const { data } = await admin
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** 人数の画面を出すか。卓が見つからない・調べられないときは出さない（注文できなくならないように） */
export async function qrStartRequired(slug: string, token: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const table = await findQrTable(admin, slug, token);
    if (!table) return false;
    return !(await openOrderOf(admin, table.id));
  } catch {
    return false;
  }
}

export type StartQrVisitResult = { ok: true; started: boolean } | { ok: false; reason: 'not_found' };

/**
 * 伝票を開く。すでに伝票がある卓（レジで着席済み・同じ卓の別のお客様が先に選んだ）は何もしない。
 * 2台で同時に押したときは、あとから作った方を取り消して1枚にする（品目の無い、いま作ったばかりの伝票だけ）。
 */
export async function startQrVisit(admin: Admin, slug: string, token: string, guests: QrGuestCounts & { total: number }): Promise<StartQrVisitResult> {
  const table = await findQrTable(admin, slug, token);
  if (!table) return { ok: false, reason: 'not_found' };
  if (await openOrderOf(admin, table.id)) return { ok: true, started: false };

  const { data: created, error } = await admin
    .from('orders')
    .insert({
      organization_id: table.organization_id,
      store_id: table.store_id,
      table_id: table.id,
      order_type: 'dine_in',
      order_source: 'qr',
      status: 'open',
      guest_count: guests.total,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? 'order insert failed');
  const orderId = created.id as string;

  // 同時に押されて2枚できたら、古い方を残す
  const first = await openOrderOf(admin, table.id);
  if (first && first.id !== orderId) {
    await admin
      .from('orders')
      .update({ status: 'cancelled', void_reason: 'QR 人数の重複（同時に開いた分）', closed_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'open');
    return { ok: true, started: false };
  }

  await admin
    .from('restaurant_tables')
    .update({ current_status: 'seated' })
    .eq('id', table.id)
    .in('current_status', ['available', 'reserved', 'waiting']);

  // 女性・男性の内訳（列が無いデータベースでは失敗するので、結果は見ない）
  await admin.from('orders').update({ guest_female: guests.female, guest_male: guests.male }).eq('id', orderId);

  await admin.rpc('log_audit', {
    p_org: table.organization_id,
    p_store: table.store_id,
    p_action: 'order.qr_start',
    p_target_table: 'orders',
    p_target_id: orderId,
    p_before: null,
    p_after: { guest_count: guests.total, guest_female: guests.female, guest_male: guests.male },
    p_note: `QR 来店人数 ${qrGuestLabel(guests)}`,
  });
  return { ok: true, started: true };
}
