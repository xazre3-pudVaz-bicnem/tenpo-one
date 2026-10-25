'use server';

import { revalidatePath } from 'next/cache';
import { assertStoreAccess, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError } from '@/lib/schema-compat';
import { currentRequestIp } from '@/lib/handy-device-server';
import { generatePairingCode, hashPairingCode, PAIRING_TTL_MS } from '@/lib/display-pairing';
import { DISPLAY_FLAG_MESSAGE, isDisplayKind, normalizeStations, type DisplayKind } from '@/lib/display-monitor';
import { loadDisplayMonitorFlag } from '@/lib/display-monitor-server';
import { DEVICE_MESSAGE } from '@/lib/device-control';

const PATH = '/app/settings/displays';

export interface IssueDisplayPairingResult {
  error?: string;
  /** QRに入れる値。画面に一度だけ渡し、DBには保存しない */
  code?: string;
  expiresAt?: string;
}

function cleanName(name: string): { name?: string; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: '端末の名前を入力してください' };
  if (trimmed.length > 40) return { error: '端末の名前は40文字以内で入力してください' };
  return { name: trimmed };
}

/**
 * ディスプレイ端末をつなぐQRを発行する（ハンディ端末と同じ: 5分・1回限り・発行したレジと同じ回線からだけ）。
 * 種類（キッチンディスプレイ／呼び出しモニター）と持ち場はQRに結び付けておき、読み取った端末にそのまま付く。
 * 運営がこの企業・店舗で ON にしていなければ発行しない。
 */
export async function issueDisplayPairing(
  storeId: string,
  input: { deviceName: string; kind: DisplayKind; stations: string[] }
): Promise<IssueDisplayPairingResult> {
  const ctx = await requirePermission('store.settings');
  assertStoreAccess(ctx, storeId);

  const n = cleanName(input.deviceName);
  if (n.error || !n.name) return { error: n.error };
  if (!isDisplayKind(input.kind)) return { error: '種類を選んでください' };
  const stations = normalizeStations(input.stations);

  const flag = await loadDisplayMonitorFlag(ctx.organizationId, storeId);
  if (!flag.on) return { error: DISPLAY_FLAG_MESSAGE[flag.reason === 'on' ? 'company_off' : flag.reason] };

  const ip = await currentRequestIp();
  if (!ip) return { error: '接続元を確認できないため発行できません。お店の回線から操作してください' };

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const supabase = await createClient();
  const { error } = await supabase.from('display_pairings').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    code_hash: hashPairingCode(code),
    issued_ip: ip,
    device_name: n.name,
    kind: input.kind,
    stations,
    expires_at: expiresAt.toISOString(),
    created_by: ctx.userId,
  });
  if (error) {
    if (isMissingTableError(error, 'display_pairings')) return { error: DISPLAY_FLAG_MESSAGE.not_ready };
    return { error: `QRコードの発行に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'display.pairing_issue',
    p_target_table: 'display_pairings',
    p_target_id: null,
    p_before: null,
    // コードそのものは記録しない
    p_after: { device_name: n.name, kind: input.kind, stations },
    p_note: null,
  });

  revalidatePath(PATH);
  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * 端末を探す（この企業・操作できる店舗の端末だけ）。読むのはログインした人の権限（RLS）で、
 * 書き込みは確かめたあとにサーバー側（サービスロール）で行う（端末の表は店の人が直接書き換えられない。migration 00103）。
 */
async function findDevice(deviceId: string) {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();
  const { data: device, error } = await supabase
    .from('display_devices')
    .select('id, organization_id, store_id, name, kind, stations, profile_id, status')
    .eq('id', deviceId)
    .maybeSingle();
  if (error && isMissingTableError(error, 'display_devices')) return { error: DISPLAY_FLAG_MESSAGE.not_ready } as const;
  if (!device) return { error: '端末が見つかりません' } as const;
  if (device.organization_id !== ctx.organizationId) return { error: 'この端末は操作できません' } as const;
  assertStoreAccess(ctx, device.store_id as string);
  return { ctx, supabase, admin: createAdminClient(), device } as const;
}

/**
 * 端末の解除（店舗の管理画面から）。
 * 2026-10-25 Ronnie「端末のことは全部コントロールセンター」: 店舗の管理画面からの解除は受け付けず、理由の文だけ返す
 * （iPad アプリの設定 › ディスプレイ端末 の古い版の「解除」もここに来る）。端末自身の「レジに戻す」は今まで通り
 * （lib/display-ops-server.ts の leaveDisplayDevice）。運営の解除は app/admin/tenants/device-actions.ts の revokeStoreDevice。
 */
export async function revokeDisplayDevice(_deviceId: string): Promise<{ error?: string }> {
  await requirePermission('store.settings');
  return { error: DEVICE_MESSAGE.storeRevokeRefused };
}

/** 端末の名前を変える（現場で見分けるため） */
export async function renameDisplayDevice(deviceId: string, name: string): Promise<{ error?: string }> {
  const n = cleanName(name);
  if (n.error || !n.name) return { error: n.error };
  const found = await findDevice(deviceId);
  if ('error' in found) return { error: found.error };
  const { admin } = found;
  const { error } = await admin.from('display_devices').update({ name: n.name, updated_at: new Date().toISOString() }).eq('id', deviceId);
  if (error) return { error: `変更に失敗しました: ${error.message}` };
  revalidatePath(PATH);
  return {};
}

/** 種類（キッチンディスプレイ／呼び出しモニター）と持ち場を変える。端末の画面は次の読み直しで切り替わる */
export async function updateDisplayDevice(deviceId: string, input: { kind: DisplayKind; stations: string[] }): Promise<{ error?: string }> {
  if (!isDisplayKind(input.kind)) return { error: '種類を選んでください' };
  const stations = normalizeStations(input.stations);
  const found = await findDevice(deviceId);
  if ('error' in found) return { error: found.error };
  const { ctx, supabase, admin, device } = found;
  if (device.status !== 'active') return { error: '解除した端末は変更できません' };
  const { error } = await admin
    .from('display_devices')
    .update({ kind: input.kind, stations, updated_at: new Date().toISOString() })
    .eq('id', deviceId);
  if (error) return { error: `変更に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: device.store_id,
    p_action: 'display.device_update',
    p_target_table: 'display_devices',
    p_target_id: deviceId,
    p_before: { kind: device.kind, stations: device.stations },
    p_after: { kind: input.kind, stations },
    p_note: null,
  });

  revalidatePath(PATH);
  return {};
}
