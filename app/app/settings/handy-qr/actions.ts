'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentRequestIp } from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { addShopNetwork, handyQrFrom, isIpLiteral, type HandyQrSettings } from '@/lib/handy-qr';

export interface ActionResult {
  error?: string;
}

type Ctx = Awaited<ReturnType<typeof requirePermission>>;

async function writeHandyQr(ctx: Ctx, storeId: string, update: (qr: HandyQrSettings) => HandyQrSettings | string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const next = update(handyQrFrom(current));
  if (typeof next === 'string') return { error: next };
  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, handyQr: next },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  revalidatePath('/app/settings/handy-qr');
  return {};
}

async function audit(ctx: Ctx, storeId: string, action: string, after: Record<string, unknown>) {
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: action,
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: after,
    p_note: null,
  });
}

const newToken = () => randomBytes(24).toString('hex');

/**
 * レジの画面が調べた、この回線の IPv4 / IPv6（api.ipify.org / api6.ipify.org）。
 * お店の回線が IPv4 と IPv6 の両方を持つとき、レジは IPv4・iPhone は IPv6 でつながることがあるので両方を登録する。
 * 操作しているのはログインした店長以上なので、送られた値をそのまま回線として使う（形だけ確認）。
 */
function extraIpsFrom(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isIpLiteral).slice(0, 2) : [];
}

/**
 * iPhone用ハンディのQRコードを作る（はじめて使うとき）。
 * 同時に、いま操作しているレジの回線を「お店のWi-Fi」として登録する（お店のWi-Fiにつないだレジで操作すること）。
 */
export async function setupHandyQr(storeId: string, extraIps: string[] = []): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);
  const ip = await currentRequestIp();
  if (!ip) return { error: '接続元を確認できません。お店のWi-Fiにつないだレジから操作してください' };
  const result = await writeHandyQr(ctx, storeId, (qr) => {
    const now = new Date().toISOString();
    let withNet = addShopNetwork(qr, ip, 'レジの回線', now);
    for (const extra of extraIpsFrom(extraIps)) {
      withNet = addShopNetwork(withNet, extra, extra.includes(':') ? 'レジの回線（IPv6）' : 'レジの回線（IPv4）', now);
    }
    return { ...withNet, token: qr.token ?? newToken() };
  });
  if (!result.error) await audit(ctx, storeId, 'handy.qr_setup', { network: networkKey(ip) });
  return result;
}

/**
 * QRコードを作り直す（貼ったQRが外に出た・写真が出回ったとき）。
 * 古いQRでは開けなくなり、今ログインしているハンディもすべて解除する。
 */
export async function regenerateHandyQr(storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);
  const result = await writeHandyQr(ctx, storeId, (qr) => ({ ...qr, token: newToken() }));
  if (result.error) return result;

  // この店のハンディ端末を全部解除（古いQRで入った端末を残さない）
  const admin = createAdminClient();
  const { data: devices } = await admin
    .from('handy_devices')
    .select('id, profile_id')
    .eq('store_id', storeId)
    .eq('status', 'active');
  for (const d of devices ?? []) {
    await admin
      .from('handy_devices')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
      .eq('id', d.id as string);
    await admin.auth.admin.signOut(d.profile_id as string, 'global').catch(() => undefined);
    await admin.from('memberships').update({ status: 'suspended' }).eq('profile_id', d.profile_id as string);
  }
  await audit(ctx, storeId, 'handy.qr_regenerate', { revoked_devices: (devices ?? []).length });
  revalidatePath('/app/settings/handy');
  return {};
}

/** いま操作しているレジ（端末）の回線を「お店のWi-Fi」に追加する */
export async function addCurrentShopNetwork(storeId: string, label: string, extraIps: string[] = []): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);
  const ip = await currentRequestIp();
  if (!ip) return { error: '接続元を確認できません' };
  const result = await writeHandyQr(ctx, storeId, (qr) => {
    const now = new Date().toISOString();
    const ips = [ip, ...extraIpsFrom(extraIps)];
    if (ips.every((x) => qr.networks.some((n) => n.key === networkKey(x)))) return 'この回線はすでに登録されています';
    let next = qr;
    for (const x of ips) next = addShopNetwork(next, x, `${label || 'お店のWi-Fi'}${x.includes(':') ? '（IPv6）' : ''}`, now);
    return next;
  });
  if (!result.error) await audit(ctx, storeId, 'handy.network_add', { network: networkKey(ip) });
  return result;
}

/** 登録した回線を外す */
export async function removeShopNetwork(storeId: string, key: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);
  const result = await writeHandyQr(ctx, storeId, (qr) => ({ ...qr, networks: qr.networks.filter((n) => n.key !== key) }));
  if (!result.error) await audit(ctx, storeId, 'handy.network_remove', { network: key });
  return result;
}
