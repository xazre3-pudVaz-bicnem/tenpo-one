'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isMissingTableError } from '@/lib/schema-compat';
import { DEFAULT_HANDY_LIMIT, DEFAULT_REGISTER_LIMIT, countsHandyDevices, countsRegisterDevices, limitFrom } from '@/lib/store-access';
import { loadStorePolicy } from '@/lib/store-access-server';
import {
  DEFAULT_DISPLAY_LIMIT,
  DEVICE_TABLES,
  DEVICE_TYPE_LABELS,
  approvalFrom,
  decideApprove,
  deviceLimitFrom,
  isDeviceType,
  type DeviceType,
} from '@/lib/device-control';
import { countStoreDevices, deviceControlReady, loadContractColumns } from '@/lib/device-control-server';
import { loadDisplayMonitorFlag } from '@/lib/display-monitor-server';
import { suspendDisplayAccount } from '@/lib/display-ops-server';
import { QR_ORDER_FLAG } from '@/lib/qr-order-flag';
import { setOrgDisplayMonitor, setStoreDisplayMonitor } from '@/app/admin/organizations/display-actions';

/**
 * コントロールセンター（運営コンソール）：端末の契約と承認・テーブルQR の ON/OFF（2026-10-25 Ronnie）。
 * 運営（cypress管理者）だけ。どの操作も監査ログ（log_audit）に残す。
 * 中身の決まりは lib/device-control.ts（純関数・テスト済み）。
 */

type Admin = ReturnType<typeof createAdminClient>;
type Result = { error?: string; warning?: string };

const NOT_READY = 'migration 00104（端末の承認）が未適用のため、まだ使えません。Supabase で 00104_control_centre_devices.sql を適用してください';

async function audit(orgId: string, storeId: string, action: string, targetTable: string, targetId: string, before: unknown, after: unknown, note: string | null = null) {
  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: orgId,
    p_store: storeId,
    p_action: action,
    p_target_table: targetTable,
    p_target_id: targetId,
    p_before: before as never,
    p_after: after as never,
    p_note: note,
  });
}

async function storeOf(admin: Admin, storeId: string): Promise<{ id: string; organizationId: string; name: string } | null> {
  const { data } = await admin.from('stores').select('id, name, organization_id').eq('id', storeId).maybeSingle();
  return data ? { id: data.id as string, organizationId: data.organization_id as string, name: (data.name as string) ?? '' } : null;
}

function revalidateStore(storeId: string, organizationId: string) {
  revalidatePath(`/admin/tenants/${storeId}`);
  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath('/admin/devices');
  revalidatePath('/app/settings/devices');
  revalidatePath('/app/settings/handy');
  revalidatePath('/app/settings/displays');
}

// -------------------------------------------------------------
// 契約（ON/OFF・台数）
// -------------------------------------------------------------

export interface SaveDeviceContractInput {
  storeId: string;
  registerEnabled: boolean;
  registerLimit: number;
  handyEnabled: boolean;
  handyLimit: number;
  displayEnabled: boolean;
  displayLimit: number;
}

/**
 * 店舗の端末の契約を保存する。
 *   レジ・ハンディ: store_access_policies（台数・ON/OFF）。ON/OFF とディスプレイの台数は migration 00104 の後だけ保存できる
 *   ディスプレイ: ON/OFF は display_monitor の機能フラグ（店舗。ON にするとき企業が OFF なら企業も ON にする）
 */
export async function saveStoreDeviceContract(input: SaveDeviceContractInput): Promise<Result> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const store = await storeOf(admin, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };
  const ready = await deviceControlReady(admin);

  const registerLimit = limitFrom(input.registerLimit, DEFAULT_REGISTER_LIMIT);
  const handyLimit = limitFrom(input.handyLimit, DEFAULT_HANDY_LIMIT);
  const displayLimit = deviceLimitFrom(input.displayLimit, DEFAULT_DISPLAY_LIMIT);

  const policyBefore = await loadStorePolicy(store.id);
  const contractBefore = await loadContractColumns(admin, store.id, ready && policyBefore.exists);
  const displayBefore = await loadDisplayMonitorFlag(store.organizationId, store.id, admin);

  const row: Record<string, unknown> = {
    store_id: store.id,
    organization_id: store.organizationId,
    register_limit: registerLimit,
    handy_limit: handyLimit,
    updated_at: new Date().toISOString(),
    updated_by: ctx.userId,
  };
  if (ready) {
    Object.assign(row, { register_enabled: input.registerEnabled === true, handy_enabled: input.handyEnabled === true, display_limit: displayLimit });
  }
  // 行がある店舗は書いた列だけ変わる（回線・メモ・レジ用パスワードの設定はそのまま）
  const { error } = await admin.from('store_access_policies').upsert(row, { onConflict: 'store_id' });
  if (error) return { error: `保存に失敗しました: ${error.message}` };

  const warnings: string[] = [];
  if (!ready && (input.registerEnabled === false || input.handyEnabled === false)) {
    warnings.push('migration 00104 が未適用のため、レジ・ハンディの契約 OFF はまだ保存できません（台数は保存しました）');
  }
  // ディスプレイ端末の ON/OFF（既存の機能フラグ。企業 × 店舗）
  try {
    if (input.displayEnabled && !displayBefore.on) {
      if (displayBefore.reason === 'not_ready') {
        warnings.push('migration 00103 が未適用のため、ディスプレイ端末はまだ ON にできません');
      } else {
        if (displayBefore.reason === 'company_off') await setOrgDisplayMonitor(store.organizationId, true);
        await setStoreDisplayMonitor(store.organizationId, store.id, true);
      }
    } else if (!input.displayEnabled && displayBefore.on) {
      await setStoreDisplayMonitor(store.organizationId, store.id, false);
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'ディスプレイ端末の ON/OFF を保存できませんでした');
  }

  await audit(
    store.organizationId,
    store.id,
    'admin.device_contract',
    'store_access_policies',
    store.id,
    {
      exists: policyBefore.exists,
      register_enabled: contractBefore.registerEnabled,
      register_limit: policyBefore.registerLimit,
      handy_enabled: contractBefore.handyEnabled,
      handy_limit: policyBefore.handyLimit,
      display_enabled: displayBefore.on,
      display_limit: contractBefore.displayLimit,
    },
    {
      register_enabled: ready ? input.registerEnabled === true : true,
      register_limit: registerLimit,
      handy_enabled: ready ? input.handyEnabled === true : true,
      handy_limit: handyLimit,
      display_enabled: input.displayEnabled === true,
      display_limit: ready ? displayLimit : contractBefore.displayLimit,
    },
    'コントロールセンター：端末の契約'
  );
  revalidateStore(store.id, store.organizationId);
  return warnings.length > 0 ? { warning: warnings.join('。') } : {};
}

// -------------------------------------------------------------
// 承認・却下・解除
// -------------------------------------------------------------

interface DeviceRow {
  id: string;
  storeId: string;
  name: string;
  status: string;
  approval: ReturnType<typeof approvalFrom>;
  profileId: string | null;
  membershipId: string | null;
}

async function loadDevice(admin: Admin, type: DeviceType, deviceId: string, ready: boolean): Promise<DeviceRow | null> {
  const base = type === 'register' ? 'id, store_id, name, status' : 'id, store_id, name, status, profile_id, membership_id';
  const { data } = await admin
    .from(DEVICE_TABLES[type])
    .select(ready ? `${base}, approval_status` : base)
    .eq('id', deviceId)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    storeId: r.store_id as string,
    name: (r.name as string | null) ?? '',
    status: r.status as string,
    approval: approvalFrom(r.approval_status),
    profileId: (r.profile_id as string | null) ?? null,
    membershipId: (r.membership_id as string | null) ?? null,
  };
}

/** 端末のアカウント（ハンディ・ディスプレイ）のログイン状態を切り、所属を止める */
async function stopDeviceAccount(admin: Admin, type: DeviceType, device: DeviceRow) {
  if (!device.profileId) return;
  await admin.auth.admin.signOut(device.profileId, 'global').catch(() => undefined);
  if (type === 'display') {
    // ディスプレイは鍵でのつなぎ直しもできないようにする（店の設定の「解除」と同じ）
    await suspendDisplayAccount(admin, device.profileId);
  } else {
    await admin.from('memberships').update({ status: 'suspended' }).eq('profile_id', device.profileId);
  }
}

export interface DeviceTarget {
  storeId: string;
  type: DeviceType;
  deviceId: string;
}

/**
 * 端末を承認する（承認待ち → 使える。運営が解除・却下したレジ・ハンディの端末の承認し直しも）。
 * 契約が OFF・台数がいっぱいなら承認しない（lib/device-control.ts の decideApprove）。
 */
export async function approveStoreDevice(input: DeviceTarget): Promise<Result> {
  const ctx = await requireCypressAdmin();
  if (!isDeviceType(input.type)) return { error: '端末の種類が正しくありません' };
  const admin = createAdminClient();
  const store = await storeOf(admin, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };
  if (!(await deviceControlReady(admin))) return { error: NOT_READY };
  const device = await loadDevice(admin, input.type, input.deviceId, true);
  if (!device || device.storeId !== store.id) return { error: '端末が見つかりません' };
  const active = device.status === 'active';
  if (input.type === 'display' && !active) {
    return { error: 'このディスプレイ端末は解除済みです。お店の設定でQRコードを出し、もう一度つないでください（つなぐと承認待ちになります）' };
  }

  const policy = await loadStorePolicy(store.id);
  const contract = await loadContractColumns(admin, store.id, policy.exists);
  let contractEnabled = true;
  let limit: number | null = null;
  if (input.type === 'register') {
    contractEnabled = contract.registerEnabled;
    limit = countsRegisterDevices(policy) ? policy.registerLimit : null;
  } else if (input.type === 'handy') {
    contractEnabled = contract.handyEnabled;
    limit = countsHandyDevices(policy) ? policy.handyLimit : null;
  } else {
    contractEnabled = (await loadDisplayMonitorFlag(store.organizationId, store.id, admin)).on;
    limit = policy.exists && contract.displayLimit > 0 ? contract.displayLimit : null;
  }
  const counts = await countStoreDevices(admin, input.type, store.id, true);
  const decision = decideApprove({ type: input.type, contractEnabled, current: device.approval, active, approvedActive: counts.approvedActive, limit });
  if (!decision.ok) return { error: decision.error };
  if (decision.noop) return {};

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { approval_status: 'approved', approved_at: now, approved_by: ctx.userId };
  if (!active) Object.assign(patch, { status: 'active', revoked_at: null, revoked_by: null });
  const { error } = await admin.from(DEVICE_TABLES[input.type]).update(patch).eq('id', device.id);
  if (error) return { error: `承認に失敗しました: ${error.message}` };
  // 承認待ちの間に止めておいた所属を戻す（ハンディ・ディスプレイの専用アカウント）
  if (device.membershipId) await admin.from('memberships').update({ status: 'active' }).eq('id', device.membershipId);

  await audit(
    store.organizationId,
    store.id,
    'admin.device_approve',
    DEVICE_TABLES[input.type],
    device.id,
    { approval_status: device.approval, status: device.status },
    { approval_status: 'approved', status: 'active', name: device.name },
    `${DEVICE_TYPE_LABELS[input.type]}を承認`
  );
  revalidateStore(store.id, store.organizationId);
  return {};
}

/** 承認待ちの端末を却下する（その端末は使えない。もう一度使うには運営が承認し直す） */
export async function rejectStoreDevice(input: DeviceTarget): Promise<Result> {
  const ctx = await requireCypressAdmin();
  if (!isDeviceType(input.type)) return { error: '端末の種類が正しくありません' };
  const admin = createAdminClient();
  const store = await storeOf(admin, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };
  if (!(await deviceControlReady(admin))) return { error: NOT_READY };
  const device = await loadDevice(admin, input.type, input.deviceId, true);
  if (!device || device.storeId !== store.id) return { error: '端末が見つかりません' };
  if (device.approval !== 'pending') return { error: 'この端末は承認待ちではありません' };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { approval_status: 'rejected', status: 'revoked', revoked_at: now, revoked_by: ctx.userId };
  if (input.type === 'display') patch.device_token_hash = null;
  const { error } = await admin.from(DEVICE_TABLES[input.type]).update(patch).eq('id', device.id);
  if (error) return { error: `却下に失敗しました: ${error.message}` };
  await stopDeviceAccount(admin, input.type, device);

  await audit(
    store.organizationId,
    store.id,
    'admin.device_reject',
    DEVICE_TABLES[input.type],
    device.id,
    { approval_status: 'pending', status: device.status },
    { approval_status: 'rejected', status: 'revoked', name: device.name },
    `${DEVICE_TYPE_LABELS[input.type]}の承認を却下`
  );
  revalidateStore(store.id, store.organizationId);
  return {};
}

/**
 * 承認済みの端末を解除する（運営だけ）。その端末はすぐ使えなくなる。
 * migration 00104 の前でも使える（今までの /admin のレジ端末の「解除」と同じ動き＋ハンディ・ディスプレイ）。
 */
export async function revokeStoreDevice(input: DeviceTarget): Promise<Result> {
  const ctx = await requireCypressAdmin();
  if (!isDeviceType(input.type)) return { error: '端末の種類が正しくありません' };
  const admin = createAdminClient();
  const store = await storeOf(admin, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };
  const ready = await deviceControlReady(admin);
  const device = await loadDevice(admin, input.type, input.deviceId, ready);
  if (!device || device.storeId !== store.id) return { error: '端末が見つかりません' };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: 'revoked', revoked_at: now, revoked_by: ctx.userId };
  if (ready) patch.approval_status = 'revoked';
  if (input.type === 'display') {
    patch.device_token_hash = null;
    patch.updated_at = now;
  }
  const { error } = await admin.from(DEVICE_TABLES[input.type]).update(patch).eq('id', device.id);
  if (error) return { error: `解除に失敗しました: ${error.message}` };
  await stopDeviceAccount(admin, input.type, device);

  await audit(
    store.organizationId,
    store.id,
    'admin.device_revoke',
    DEVICE_TABLES[input.type],
    device.id,
    { approval_status: device.approval, status: device.status },
    { approval_status: ready ? 'revoked' : device.approval, status: 'revoked', name: device.name },
    `${DEVICE_TYPE_LABELS[input.type]}を解除（運営）`
  );
  revalidateStore(store.id, store.organizationId);
  return {};
}

// -------------------------------------------------------------
// テーブルQR（お客様の QR 注文）
// -------------------------------------------------------------

/**
 * 店舗のテーブルQR を ON/OFF する（store_feature_flags の qr_order。行が無い＝ON）。
 * OFF の店舗は、卓の QR を読むと「この店舗では QR 注文を受け付けていません」（注文の作成も DB で止まる＝migration 00104 の後）。
 */
export async function setStoreQrOrder(input: { storeId: string; enabled: boolean }): Promise<Result> {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();
  const store = await storeOf(admin, input.storeId);
  if (!store) return { error: '店舗が見つかりません' };

  const { data: existing, error: readErr } = await admin
    .from('store_feature_flags')
    .select('id, enabled')
    .eq('store_id', store.id)
    .eq('flag_key', QR_ORDER_FLAG)
    .maybeSingle();
  if (readErr) {
    if (isMissingTableError(readErr, 'store_feature_flags')) {
      return { error: 'migration 00103（store_feature_flags）が未適用のため、店舗ごとのテーブルQR の ON/OFF はまだ使えません' };
    }
    return { error: readErr.message };
  }
  const enabled = input.enabled === true;
  const { error } = await admin.from('store_feature_flags').upsert(
    {
      organization_id: store.organizationId,
      store_id: store.id,
      flag_key: QR_ORDER_FLAG,
      enabled,
      note: 'テーブルQR（お客様の QR 注文）。行が無い＝ON',
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id,flag_key' }
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };

  const ready = await deviceControlReady(admin);
  await audit(
    store.organizationId,
    store.id,
    'admin.qr_order_store',
    'store_feature_flags',
    store.id,
    { enabled: existing ? existing.enabled === true : true },
    { enabled },
    enabled ? 'テーブルQR を ON' : 'テーブルQR を OFF'
  );
  revalidatePath(`/admin/tenants/${store.id}`);
  revalidatePath('/app/settings/tables/qr-print');
  revalidatePath('/app/settings/qr-service');
  return !enabled && !ready
    ? { warning: 'お客様の画面は止めました。注文の作成を DB でも止めるのは migration 00104 の適用後です' }
    : {};
}
