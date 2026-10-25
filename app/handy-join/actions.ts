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
import { loadStorePolicy } from '@/lib/store-access-server';
import { ACCESS_MESSAGE, canAddHandyDevice, isAllowedNetwork, isRestricted } from '@/lib/store-access';
import { HANDY_OUTSIDE_COOKIE, handyQrFrom, isHandyQrToken, isShopNetwork, isWifiGuarded } from '@/lib/handy-qr';
import { ensureHandyDeviceToken, gateHandyJoin, handyContractOff, signInApprovedHandy } from '@/lib/handy-device-approval-server';
import { DEVICE_MESSAGE } from '@/lib/device-control';

export type JoinResult = { ok: true; storeName: string } | { ok: false; error: string };

/**
 * iPhone用ハンディ：お店の固定QRを読んだ端末を、そのままハンディとしてログインさせる。
 * 呼び出し元は未ログインの端末なので、次をすべて満たすときだけ成立させる:
 *   - QR の値がどこかの店舗の今のQRと一致する（再発行した古いQRは使えない）
 *   - 「お店のWi-Fiだけで使う」がオンの店なら、お店のWi-Fi（レジで登録した回線）から来ている
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
  // 契約で運営が登録した回線（store_access_policies）でも開ける
  const policy = await loadStorePolicy(store.id as string);
  // 「お店のWi-Fiだけで使う」をオンにした店（か運営が回線を制限した店）だけ回線を見る。既定はどこからでも開く
  const guarded = isWifiGuarded(qr) || isRestricted(policy);
  const allowed = !guarded || isShopNetwork(qr, ip) || (isRestricted(policy) && isAllowedNetwork(policy, ip));
  if (!allowed) {
    // iPhone の iCloud プライベートリレー（Safari）がオンだと、お店の Wi-Fi でも Apple 側の回線（172.224.0.0/12 など）に見える
    // （2026-09-27 FULLMOoN 新宿で 172.226.x.x のまま入れなかった）。その場合は切り方を案内する
    const ua = (await headers()).get('user-agent') ?? '';
    const relay = ip ? isLikelyPrivateRelay(ip) : false;
    const ios = /iPhone|iPad/i.test(ua);
    const hint = relay
      ? '\n\niPhone の「プライベートリレー」がオンのため、お店のWi-Fiでも別の回線に見えています。設定 → Wi-Fi → お店のWi-Fiの (i) →「IPアドレスのトラッキングを制限」をオフ（または 設定 → Apple ID → iCloud → プライベートリレー をオフ）にして、もう一度読み取ってください。'
      : ios
        ? '\n\nお店のWi-Fiにつないでいるのに開けないときは、設定 → Wi-Fi → お店のWi-Fiの (i) →「IPアドレスのトラッキングを制限」をオフにしてから、もう一度読み取ってください。'
        : '';
    return {
      ok: false,
      error: `お店のWi-Fiに接続してから読み取ってください（スマホの回線やほかのWi-Fiでは開けません）。この端末の回線: ${ip ? networkKey(ip) : '不明'}${hint}`,
    };
  }

  // コントロールセンター（2026-10-25）: ハンディの契約が OFF の店舗では入れない（migration 00104 の前は何もしない）
  if (await handyContractOff(store.id as string, policy)) return { ok: false, error: DEVICE_MESSAGE.contractOff.handy };

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
      // 端末の鍵（自動ログアウトのあと、承認し直しにならないように）
      await ensureHandyDeviceToken(mine.id as string);
      return { ok: true, storeName: store.name as string };
    }
    await supabase.auth.signOut();
  }

  const h = await headers();
  const ua = h.get('user-agent')?.slice(0, 200) ?? null;
  const now = new Date(Date.now() + 9 * 60 * 60_000);
  const name = `${/iPhone/i.test(ua ?? '') ? 'iPhone' : 'スマホ'}（QR ${now.getUTCMonth() + 1}/${now.getUTCDate()} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}）`;

  // コントロールセンター（migration 00104 の後）。承認制を ON にした店舗（移行期間のあと）の新しい端末は承認待ち、
  // 承認済みの端末（自動ログアウトで止まった端末も）はそのままログイン。承認制 OFF の店舗は今まで通り作る（端末の鍵つき）
  const gate = await gateHandyJoin(admin, {
    organizationId: store.organization_id as string,
    storeId: store.id as string,
    policy,
    deviceName: name,
    ip,
    userAgent: ua,
    createdBy: null,
    legacyLimit: true,
  });
  if (gate.kind === 'blocked') return { ok: false, error: gate.message };
  if (gate.kind === 'pending' || gate.kind === 'approved') {
    if (gate.kind === 'approved') {
      const signed = await signInApprovedHandy(admin, gate);
      if (signed.error) return { ok: false, error: signed.error };
      (await cookies()).delete(HANDY_OUTSIDE_COOKIE);
    }
    await admin.rpc('log_audit', {
      p_org: store.organization_id as string,
      p_store: store.id as string,
      p_action: gate.kind === 'pending' ? 'device.handy_request' : gate.created ? 'handy.device_join_qr' : 'handy.device_rejoin_qr',
      p_target_table: 'handy_devices',
      p_target_id: gate.deviceId,
      p_before: null,
      p_after: gate.kind === 'pending' ? { name, ip, approval_status: 'pending' } : gate.created ? { name, ip } : { ip, reactivated: gate.reactivate },
      p_note: gate.kind === 'pending' ? '新しいハンディ端末（QR）。TENPO ONE 運営の承認待ち' : null,
    });
    return gate.kind === 'pending' ? { ok: false, error: gate.message } : { ok: true, storeName: store.name as string };
  }

  // ここから下は migration 00104 の前（今まで通り）
  // 契約したハンディの台数まで（回線を登録していない店舗は数えない）
  const { count: handyCount } = await admin
    .from('handy_devices')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', store.id as string)
    .eq('status', 'active');
  if (!canAddHandyDevice(policy, handyCount ?? 0)) return { ok: false, error: ACCESS_MESSAGE.handyLimit };

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
    // 端末の鍵（コントロールセンター。migration 00104 の後だけ・無いときだけ入れる）
    if (device) await ensureHandyDeviceToken(device.id);
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

/** iCloud プライベートリレーの出口（Akamai 172.224.0.0/12・Cloudflare 104.28.0.0/16 等）らしい IP か */
function isLikelyPrivateRelay(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (a === 172 && b >= 224 && b <= 239) || (a === 104 && b === 28);
}
