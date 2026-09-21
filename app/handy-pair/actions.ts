'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clientIpFrom,
  handyDeviceEmail,
  hashPairingCode,
  isPairingCode,
  PAIRING_FAILURE_MESSAGE,
  pairingFailure,
} from '@/lib/handy-pairing';

/**
 * QRを読み取った端末をこの店舗のハンディとして登録し、そのままログイン状態にする。
 *
 * 呼び出し元は未ログインの他人の端末なので、次をすべて満たすときだけ成立させる:
 *   - コードの形式が正しい
 *   - 未使用・期限内のQRである
 *   - QRを表示したレジと同じ接続元IP（＝同じWi-Fi）から来ている
 * 失敗した理由は現場が対処できる日本語で返す（成功したように見せない）。
 */
export async function pairHandyDevice(code: string): Promise<{ error?: string; storeName?: string }> {
  if (!isPairingCode(code)) {
    return { error: PAIRING_FAILURE_MESSAGE.NOT_FOUND };
  }

  const h = await headers();
  const ip = clientIpFrom({ forwardedFor: h.get('x-forwarded-for'), realIp: h.get('x-real-ip') });
  const userAgent = h.get('user-agent')?.slice(0, 200) ?? null;

  // 未ログインからの呼び出しのため、ここだけサービスロールで照合する（検証は下で自前に行う）
  const admin = createAdminClient();
  const { data: pairing } = await admin
    .from('handy_pairings')
    .select('id, organization_id, store_id, issued_ip, device_name, expires_at, used_at, created_by')
    .eq('code_hash', hashPairingCode(code))
    .maybeSingle();

  const failure = pairingFailure(
    pairing
      ? {
          expiresAt: new Date(pairing.expires_at as string).getTime(),
          usedAt: pairing.used_at ? new Date(pairing.used_at as string).getTime() : null,
          issuedIp: pairing.issued_ip as string,
        }
      : null,
    Date.now(),
    ip
  );
  if (failure || !pairing) {
    return { error: PAIRING_FAILURE_MESSAGE[failure ?? 'NOT_FOUND'] };
  }

  const { data: store } = await admin
    .from('stores')
    .select('id, name, organization_id, status')
    .eq('id', pairing.store_id as string)
    .maybeSingle();
  if (!store || store.status !== 'active') {
    return { error: 'この店舗は現在利用できません。管理者にご連絡ください' };
  }

  // 端末ごとに専用のログインアカウントを作る（1台ずつ解除できるようにするため）。
  // 権限はアルバイトと同じ範囲（注文・会計・テーブル操作）で、設定や経理は触れない。
  const deviceKey = crypto.randomUUID();
  const email = handyDeviceEmail(deviceKey);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { display_name: `${pairing.device_name}（ハンディ）`, handy_device: true },
  });
  if (createErr || !created?.user) {
    return { error: `端末の登録に失敗しました: ${createErr?.message ?? '不明なエラー'}` };
  }

  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .insert({
      organization_id: pairing.organization_id as string,
      profile_id: created.user.id,
      role: 'part_time',
      status: 'active',
      created_by: pairing.created_by ?? null,
    })
    .select('id')
    .single();
  if (memErr || !membership) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return { error: `端末の登録に失敗しました: ${memErr?.message ?? '不明なエラー'}` };
  }

  const { error: storeErr } = await admin
    .from('membership_stores')
    .insert({ membership_id: membership.id as string, store_id: store.id, is_primary: true });
  if (storeErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return { error: `端末の登録に失敗しました: ${storeErr.message}` };
  }

  const { data: device, error: deviceErr } = await admin
    .from('handy_devices')
    .insert({
      organization_id: pairing.organization_id as string,
      store_id: store.id,
      name: pairing.device_name as string,
      profile_id: created.user.id,
      membership_id: membership.id as string,
      paired_ip: ip,
      user_agent: userAgent,
      last_seen_at: new Date().toISOString(),
      created_by: pairing.created_by ?? null,
    })
    .select('id')
    .single();
  if (deviceErr || !device) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return { error: `端末の登録に失敗しました: ${deviceErr?.message ?? '不明なエラー'}` };
  }

  // QRは1回限り。先に使用済みにしてから、ログイン状態を渡す
  const { data: consumed } = await admin
    .from('handy_pairings')
    .update({ used_at: new Date().toISOString(), device_id: device.id as string })
    .eq('id', pairing.id as string)
    .is('used_at', null)
    .select('id');
  if (!consumed || consumed.length === 0) {
    // ほぼ同時に別の端末が使った場合。作りかけの端末を残さない
    await admin.from('handy_devices').delete().eq('id', device.id as string);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return { error: PAIRING_FAILURE_MESSAGE.USED };
  }

  // この端末にログイン状態（cookie）を渡す。パスワードは端末に残さない
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { error: `ログインの準備に失敗しました: ${linkErr?.message ?? '不明なエラー'}` };
  }

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyErr) {
    return { error: `ログインに失敗しました: ${verifyErr.message}` };
  }

  await admin.rpc('log_audit', {
    p_org: pairing.organization_id as string,
    p_store: store.id,
    p_action: 'handy.device_pair',
    p_target_table: 'handy_devices',
    p_target_id: device.id as string,
    p_before: null,
    p_after: { name: pairing.device_name, ip },
    p_note: null,
  });

  return { storeName: store.name as string };
}
