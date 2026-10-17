/**
 * お客様QRの最初の画面（ご来店の人数）のサーバー側。
 * - qrStartRequired: その卓にまだ伝票（未会計の注文）が無いか（無ければ人数の画面を出す）
 * - applyQrGuests: 最初の注文のあとに、選んだ人数（合計・女性・男性）を伝票に入れる
 *
 * 人数を選んだだけでは伝票を開かない（卓も着席にならない）。伝票は最初の注文で create_qr_order が開く
 * （2026-10-17 Ronnie「注文してから着席にする」）。
 * お客様は匿名なので、卓の QR（店の slug＋卓の token）が合っているときだけ動く。内訳は操作履歴にも残す。
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

export type ApplyQrGuestsResult = { ok: true; applied: boolean } | { ok: false; reason: 'not_found' };

/**
 * お客様が最初の注文を送ったあとに、選んだ人数（女性・男性）を伝票に入れる。
 * 伝票を開くのは最初の注文（create_qr_order）。人数を選んだだけでは伝票を開かない・卓も着席にしない
 * （2026-10-17 Ronnie「QR を読んだだけでレジの卓が ¥0 で着席になる。注文してから着席にする」）。
 * 入れるのは、お客様が QR で開いた伝票で、まだ内訳が入っていないときだけ（レジで着席した伝票・先に別のスマホで入れた伝票は変えない）。
 */
export async function applyQrGuests(admin: Admin, slug: string, token: string, guests: QrGuestCounts & { total: number }): Promise<ApplyQrGuestsResult> {
  const table = await findQrTable(admin, slug, token);
  if (!table) return { ok: false, reason: 'not_found' };
  const open = await openOrderOf(admin, table.id);
  if (!open) return { ok: true, applied: false };

  const { data: order } = await admin
    .from('orders')
    .select('id, order_source, guest_count, guest_female, guest_male')
    .eq('id', open.id)
    .maybeSingle();
  if (!order || order.order_source !== 'qr' || order.guest_female != null || order.guest_male != null) {
    return { ok: true, applied: false };
  }

  const { error } = await admin
    .from('orders')
    .update({ guest_count: guests.total, guest_female: guests.female, guest_male: guests.male })
    .eq('id', order.id)
    .is('guest_female', null)
    .is('guest_male', null);
  if (error) throw new Error(error.message);

  await admin.rpc('log_audit', {
    p_org: table.organization_id,
    p_store: table.store_id,
    p_action: 'order.qr_guests',
    p_target_table: 'orders',
    p_target_id: order.id,
    p_before: { guest_count: order.guest_count },
    p_after: { guest_count: guests.total, guest_female: guests.female, guest_male: guests.male },
    p_note: `QR 来店人数 ${qrGuestLabel(guests)}`,
  });
  return { ok: true, applied: true };
}
