import 'server-only';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientIpFrom, handyDeviceEmail } from '@/lib/handy-pairing';
import {
  HANDY_OUTSIDE_COOKIE,
  decideOutside,
  handyQrFrom,
  isShopNetwork,
  isWifiGuarded,
  parseOutsideSince,
  type HandyQrSettings,
  type OutsideDecision,
} from '@/lib/handy-qr';

type Admin = ReturnType<typeof createAdminClient>;

/** 接続元IP（x-forwarded-for の先頭）。取れなければ null */
export async function currentRequestIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom({ forwardedFor: h.get('x-forwarded-for'), realIp: h.get('x-real-ip') });
}

/** 店舗の iPhone用ハンディ設定（store_settings.settings.handyQr） */
export async function loadHandyQr(client: Admin, storeId: string): Promise<{ qr: HandyQrSettings; settings: Record<string, unknown> }> {
  const { data } = await client.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  return { qr: handyQrFrom(settings), settings };
}

/**
 * ハンディ端末（専用アカウント）を作って、この端末にログイン状態を渡す。
 * 権限はアルバイトと同じ範囲（注文・会計・テーブル操作）。1台ずつ解除できる。
 */
export async function createHandyDeviceSession(
  admin: Admin,
  input: { organizationId: string; storeId: string; deviceName: string; ip: string | null; userAgent: string | null; createdBy: string | null }
): Promise<{ deviceId?: string; error?: string }> {
  const created = await createHandyDeviceAccount(admin, input);
  if (created.error || !created.deviceId || !created.email) return { error: created.error ?? '端末の登録に失敗しました' };
  const signed = await signInHandyDeviceEmail(created.email);
  if (signed.error) return { error: signed.error };
  return { deviceId: created.deviceId };
}

/** 端末のアカウントでこの端末にログイン状態（cookie）を渡す。パスワードは端末に残さない */
export async function signInHandyDeviceEmail(email: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { error: `ログインの準備に失敗しました: ${linkErr?.message ?? '不明なエラー'}` };
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyErr) return { error: `ログインに失敗しました: ${verifyErr.message}` };
  return {};
}

/**
 * ハンディ端末の専用アカウントと handy_devices の行を作る（ログイン状態はまだ渡さない）。
 * pending = コントロールセンターの承認待ちで作る（migration 00104 の後だけ渡す）。承認待ちの間は所属を止めておき、
 * 運営が承認したときに戻す。tokenHash = 端末の鍵（Cookie）のハッシュ（次に QR を読んだときに同じ端末と分かるように）。
 */
export async function createHandyDeviceAccount(
  admin: Admin,
  input: {
    organizationId: string;
    storeId: string;
    deviceName: string;
    ip: string | null;
    userAgent: string | null;
    createdBy: string | null;
    pending?: boolean;
    /** 承認制の移行期間に作った端末（すぐ使えるが、運営の一覧で「自動承認」と分かるように承認の時刻だけ入れる） */
    autoApproved?: boolean;
    tokenHash?: string | null;
  }
): Promise<{ deviceId?: string; profileId?: string; email?: string; error?: string }> {
  const deviceKey = crypto.randomUUID();
  const email = handyDeviceEmail(deviceKey);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { display_name: `${input.deviceName}（ハンディ）`, handy_device: true },
  });
  if (createErr || !created?.user) return { error: `端末の登録に失敗しました: ${createErr?.message ?? '不明なエラー'}` };
  const userId = created.user.id;
  const fail = async (msg: string) => {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return { error: `端末の登録に失敗しました: ${msg}` };
  };

  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .insert({
      organization_id: input.organizationId,
      profile_id: userId,
      role: 'part_time',
      // 承認待ちの端末は、運営が承認するまで所属を止めておく（万一ログインできても何も開けない）
      status: input.pending ? 'suspended' : 'active',
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (memErr || !membership) return fail(memErr?.message ?? '不明なエラー');

  const { error: storeErr } = await admin
    .from('membership_stores')
    .insert({ membership_id: membership.id as string, store_id: input.storeId, is_primary: true });
  if (storeErr) return fail(storeErr.message);

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    store_id: input.storeId,
    name: input.deviceName,
    profile_id: userId,
    membership_id: membership.id as string,
    paired_ip: input.ip,
    user_agent: input.userAgent,
    last_seen_at: now,
    created_by: input.createdBy,
  };
  // migration 00104 の列（呼び出し側が適用済みを確かめてから渡す）
  if (input.pending) Object.assign(row, { approval_status: 'pending', approval_requested_at: now });
  else if (input.autoApproved) Object.assign(row, { approval_status: 'approved', approved_at: now });
  if (input.tokenHash) row.device_token_hash = input.tokenHash;
  const { data: device, error: deviceErr } = await admin.from('handy_devices').insert(row).select('id').single();
  if (deviceErr || !device) return fail(deviceErr?.message ?? '不明なエラー');

  return { deviceId: device.id as string, profileId: userId, email };
}

/** 端末を解除（ログイン状態を切り、アカウントを止める） */
export async function revokeHandyDeviceSystem(admin: Admin, device: { id: string; profileId: string; organizationId: string; storeId: string; name: string }, reason: string) {
  await admin
    .from('handy_devices')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', device.id)
    .eq('status', 'active');
  await admin.auth.admin.signOut(device.profileId, 'global').catch(() => undefined);
  await admin.from('memberships').update({ status: 'suspended' }).eq('profile_id', device.profileId);
  await admin.rpc('log_audit', {
    p_org: device.organizationId,
    p_store: device.storeId,
    p_action: 'handy.device_auto_revoke',
    p_target_table: 'handy_devices',
    p_target_id: device.id,
    p_before: { status: 'active' },
    p_after: { status: 'revoked', name: device.name },
    p_note: reason,
  });
}

export interface HandyGuardResult {
  /** ハンディ端末のアカウントか（普通のスタッフのアカウントは Wi-Fi 判定しない） */
  isDevice: boolean;
  decision: OutsideDecision;
  device: { id: string; profileId: string; organizationId: string; storeId: string; name: string } | null;
}

/**
 * ハンディ端末が「お店のWi-Fi」にいるか。
 * 店が回線を登録していなければ判定しない（今まで通り）。
 * 外にいる時間は Cookie（HANDY_OUTSIDE_COOKIE）で数える。
 */
export async function checkHandyNetwork(): Promise<HandyGuardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.user_metadata?.handy_device !== true) return { isDevice: false, decision: { kind: 'ok' }, device: null };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('handy_devices')
    .select('id, profile_id, organization_id, store_id, name, status')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!row || row.status !== 'active') return { isDevice: true, decision: { kind: 'logout' }, device: null };
  const device = {
    id: row.id as string,
    profileId: row.profile_id as string,
    organizationId: row.organization_id as string,
    storeId: row.store_id as string,
    name: row.name as string,
  };

  const { qr } = await loadHandyQr(admin, device.storeId);
  // 契約で運営が登録した回線（store_access_policies）も「お店の回線」として扱う
  const { loadStorePolicy } = await import('@/lib/store-access-server');
  const { isAllowedNetwork, isRestricted } = await import('@/lib/store-access');
  const policy = await loadStorePolicy(device.storeId);
  const ip = await currentRequestIp();
  const jar = await cookies();
  const decision = decideOutside({
    guarded: isWifiGuarded(qr) || isRestricted(policy),
    inside: isShopNetwork(qr, ip) || (isRestricted(policy) && isAllowedNetwork(policy, ip)),
    outsideSince: parseOutsideSince(jar.get(HANDY_OUTSIDE_COOKIE)?.value),
    now: Date.now(),
  });
  return { isDevice: true, decision, device };
}

/** お店のWi-Fiの外からの注文・厨房への送信を止めるときの文言 */
export const HANDY_OUTSIDE_ORDER_MESSAGE =
  'お店のWi-Fiの外からは注文・厨房への送信・会計はできません。お店のWi-Fiにつないでください';

/**
 * ハンディ端末からの操作（Server Action）は、お店のWi-Fiにいるときだけ受け付ける。
 * 外に出た直後（ログアウトまでの3分間）でも、注文・厨房送信などはすぐ止める。
 * 回線を登録していない店、ハンディ端末でないアカウントは何もしない。
 */
export async function assertHandyOnShopNetwork(): Promise<void> {
  const result = await checkHandyNetwork();
  if (result.isDevice && result.decision.kind !== 'ok') {
    throw new Error(HANDY_OUTSIDE_ORDER_MESSAGE);
  }
  // コントロールセンター（2026-10-25）: ハンディの契約が OFF の店舗では、ハンディ端末からの操作を止める
  // （ログアウト・解除はしない。契約を ON に戻せばそのまま使える。migration 00104 の前は何もしない）
  if (result.isDevice && result.device) {
    const { handyContractOff } = await import('@/lib/handy-device-approval-server');
    if (await handyContractOff(result.device.storeId)) {
      const { DEVICE_MESSAGE } = await import('@/lib/device-control');
      throw new Error(DEVICE_MESSAGE.contractOff.handy);
    }
  }
}
