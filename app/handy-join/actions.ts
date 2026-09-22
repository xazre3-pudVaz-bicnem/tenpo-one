'use server';

import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  checkHandyNetwork,
  createHandyDeviceSession,
  currentRequestIp,
  revokeHandyDeviceSystem,
} from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { HANDY_OUTSIDE_COOKIE, handyQrFrom, isHandyQrToken, isShopNetwork } from '@/lib/handy-qr';

export type JoinResult = { ok: true; storeName: string } | { ok: false; error: string };

/**
 * iPhone用ハンディ：お店の固定QRを読んだ端末を、そのままハンディとしてログインさせる。
 * 呼び出し元は未ログインの端末なので、次をすべて満たすときだけ成立させる:
 *   - QR の値がどこかの店舗の今のQRと一致する（再発行した古いQRは使えない）
 *   - お店のWi-Fi（レジで登録した回線）から来ている
 */
export async function joinHandyByQr(token: string): Promise<JoinResult> {
  if (!isHandyQrToken(token)) return { ok: false, error: 'このQRコードは使えません。お店に貼ってあるQRコードを読み取ってください' };
  const qrToken = token.toLowerCase();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from('store_settings')
    .select('store_id, organization_id, settings')
    .eq('settings->handyQr->>token', qrToken)
    .limit(2);
  const row = rows && rows.length === 1 ? rows[0] : null;
  if (!row) return { ok: false, error: 'このQRコードは使えません（作り直された古いQRコードかもしれません）。お店の新しいQRコードを読み取ってください' };
  const qr = handyQrFrom(row.settings);

  const { data: store } = await admin
    .from('stores')
    .select('id, name, organization_id, status')
    .eq('id', row.store_id as string)
    .maybeSingle();
  if (!store || store.status !== 'active') return { ok: false, error: 'この店舗は現在利用できません。管理者にご連絡ください' };

  const ip = await currentRequestIp();
  if (!isShopNetwork(qr, ip)) {
    return {
      ok: false,
      error: `お店のWi-Fiに接続してから読み取ってください（スマホの回線やほかのWi-Fiでは開けません）。この端末の回線: ${ip ? networkKey(ip) : '不明'}`,
    };
  }

  // すでにこの店のハンディとしてログインしている端末は、そのまま開く
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && user.user_metadata?.handy_device === true) {
    const { data: mine } = await admin
      .from('handy_devices')
      .select('id, store_id, status')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (mine && mine.status === 'active' && mine.store_id === store.id) {
      (await cookies()).delete(HANDY_OUTSIDE_COOKIE);
      return { ok: true, storeName: store.name as string };
    }
    await supabase.auth.signOut();
  }

  const h = await headers();
  const ua = h.get('user-agent')?.slice(0, 200) ?? null;
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  const name = `${/iPhone/i.test(ua ?? '') ? 'iPhone' : 'スマホ'}（QR ${now.getUTCMonth() + 1}/${now.getUTCDate()} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}）`;

  const created = await createHandyDeviceSession(admin, {
    organizationId: store.organization_id as string,
    storeId: store.id as string,
    deviceName: name,
    ip,
    userAgent: ua,
    createdBy: null,
  });
  if (created.error || !created.deviceId) return { ok: false, error: created.error ?? '端末の登録に失敗しました' };

  (await cookies()).delete(HANDY_OUTSIDE_COOKIE);
  await admin.rpc('log_audit', {
    p_org: store.organization_id as string,
    p_store: store.id as string,
    p_action: 'handy.device_join_qr',
    p_target_table: 'handy_devices',
    p_target_id: created.deviceId,
    p_before: null,
    p_after: { name, ip },
    p_note: null,
  });
  return { ok: true, storeName: store.name as string };
}

export type HeartbeatResult = { kind: 'ok' } | { kind: 'outside'; remainingMs: number } | { kind: 'logout' };

/**
 * ハンディ端末の見守り（画面から30秒ごと・画面に戻ったとき）。
 * お店のWi-Fiの外に3分いたら端末を解除してログアウトする。
 */
export async function handyHeartbeat(): Promise<HeartbeatResult> {
  const result = await checkHandyNetwork();
  const jar = await cookies();
  if (!result.isDevice) return { kind: 'ok' };

  const { decision, device } = result;
  if (decision.kind === 'ok') {
    if (jar.get(HANDY_OUTSIDE_COOKIE)) jar.delete(HANDY_OUTSIDE_COOKIE);
    return { kind: 'ok' };
  }
  if (decision.kind === 'outside') {
    jar.set(HANDY_OUTSIDE_COOKIE, String(decision.since), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return { kind: 'outside', remainingMs: decision.remainingMs };
  }

  // 3分たった（または解除済み）: 端末を解除してログアウト
  if (device) {
    await revokeHandyDeviceSystem(createAdminClient(), device, 'お店のWi-Fiの外に3分以上いたため自動でログアウト');
  }
  jar.delete(HANDY_OUTSIDE_COOKIE);
  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => undefined);
  return { kind: 'logout' };
}
