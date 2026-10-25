'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clientIpFrom,
  generatePairingCode,
  hashPairingCode,
  PAIRING_TTL_MS,
} from '@/lib/handy-pairing';

/** 接続元IP（x-forwarded-for の先頭）。取れなければ null */
async function requestIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom({ forwardedFor: h.get('x-forwarded-for'), realIp: h.get('x-real-ip') });
}

export interface IssuePairingResult {
  error?: string;
  /** QRに入れる値。画面に一度だけ渡し、DBには保存しない */
  code?: string;
  expiresAt?: string;
}

/**
 * ハンディ端末をつなぐQRを発行する。
 * 5分・1回限り。読み取り側は「このリクエストと同じ接続元IP」でなければペアリングできない
 * （＝店のWi-Fiにつないでいるときだけ設定できる）。
 */
export async function issueHandyPairing(storeId: string, deviceName: string): Promise<IssuePairingResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);

  const name = deviceName.trim();
  if (!name) return { error: '端末の名前を入力してください' };
  if (name.length > 40) return { error: '端末の名前は40文字以内で入力してください' };

  const ip = await requestIp();
  if (!ip) {
    return { error: '接続元を確認できないため発行できません。店舗のネットワークから操作してください' };
  }

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

  const supabase = await createClient();
  const { error } = await supabase.from('handy_pairings').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    code_hash: hashPairingCode(code),
    issued_ip: ip,
    device_name: name,
    expires_at: expiresAt.toISOString(),
    created_by: ctx.userId,
  });
  if (error) return { error: `QRコードの発行に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'handy.pairing_issue',
    p_target_table: 'handy_pairings',
    p_target_id: null,
    p_before: null,
    // コードそのものは記録しない
    p_after: { device_name: name },
    p_note: null,
  });

  revalidatePath('/app/settings/handy');
  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * 端末の接続を解除する。以降その端末からは開けなくなる
 * （端末用アカウントのセッションを切り、ログインも止める）。
 */
export async function revokeHandyDevice(deviceId: string): Promise<{ error?: string }> {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();

  const { data: device } = await supabase
    .from('handy_devices')
    .select('id, organization_id, store_id, name, profile_id, status')
    .eq('id', deviceId)
    .maybeSingle();
  if (!device) return { error: '端末が見つかりません' };
  if (device.organization_id !== ctx.organizationId) return { error: 'この端末は操作できません' };
  assertStoreAccess(ctx, device.store_id);
  if (device.status === 'revoked') return {};

  const { error } = await supabase
    .from('handy_devices')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
    .eq('id', deviceId)
    .eq('status', 'active');
  if (error) return { error: `解除に失敗しました: ${error.message}` };

  // 端末に残っているログイン状態を無効化する（解除したのに使えてしまう状態を作らない）
  const admin = createAdminClient();
  await admin.auth.admin.signOut(device.profile_id as string, 'global').catch(() => undefined);
  await admin
    .from('memberships')
    .update({ status: 'suspended' })
    .eq('profile_id', device.profile_id as string);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: device.store_id,
    p_action: 'handy.device_revoke',
    p_target_table: 'handy_devices',
    p_target_id: deviceId,
    p_before: { status: 'active' },
    p_after: { status: 'revoked', name: device.name },
    p_note: null,
  });

  revalidatePath('/app/settings/handy');
  return {};
}

/** 端末の名前を変える（現場で見分けるため） */
export async function renameHandyDevice(deviceId: string, name: string): Promise<{ error?: string }> {
  const ctx = await requirePermission('store.settings');
  const trimmed = name.trim();
  if (!trimmed) return { error: '端末の名前を入力してください' };
  if (trimmed.length > 40) return { error: '端末の名前は40文字以内で入力してください' };

  const supabase = await createClient();
  const { data: device } = await supabase
    .from('handy_devices')
    .select('id, organization_id, store_id')
    .eq('id', deviceId)
    .maybeSingle();
  if (!device) return { error: '端末が見つかりません' };
  if (device.organization_id !== ctx.organizationId) return { error: 'この端末は操作できません' };
  assertStoreAccess(ctx, device.store_id);

  const { error } = await supabase.from('handy_devices').update({ name: trimmed }).eq('id', deviceId);
  if (error) return { error: `変更に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/handy');
  return {};
}
