'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  clientIpFrom,
  generatePairingCode,
  hashPairingCode,
  PAIRING_TTL_MS,
} from '@/lib/handy-pairing';
import { DEVICE_MESSAGE } from '@/lib/device-control';

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
 * 端末の接続の解除（店舗の管理画面から）。
 * 2026-10-25 Ronnie「端末のことは全部コントロールセンター」: 店舗の管理画面からの解除は受け付けず、理由の文だけ返す
 * （iPad アプリの設定 › ハンディ端末 の古い版の「解除」もここに来る）。
 * 運営の解除は app/admin/tenants/device-actions.ts の revokeStoreDevice（ログイン状態を切り、所属を止める）。
 */
export async function revokeHandyDevice(_deviceId: string): Promise<{ error?: string }> {
  await requirePermission('store.settings');
  return { error: DEVICE_MESSAGE.storeRevokeRefused };
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
