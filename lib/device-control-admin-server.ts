import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError } from '@/lib/schema-compat';
import { countsRegisterDevices } from '@/lib/store-access';
import { loadStorePolicy } from '@/lib/store-access-server';
import { deviceModelFromUserAgent, DISPLAY_KIND_LABELS, isDisplayKind } from '@/lib/display-monitor';
import { loadDisplayMonitorFlag } from '@/lib/display-monitor-server';
import { loadQrOrderFlag } from '@/lib/qr-order-flag-server';
import { DEVICE_TYPES, type ApprovalStatus, type DeviceType } from '@/lib/device-control';
import { deviceControlReady, loadContractColumns, selectDevicesWithApproval } from '@/lib/device-control-server';
import type { QrOrderFlagReason } from '@/lib/qr-order-flag';
import type { DisplayMonitorFlagReason } from '@/lib/display-monitor';

/**
 * 運営コンソール（コントロールセンター）の「端末の契約と承認」の読み込み。
 *   - 店舗ごと（/admin/tenants/[storeId]）: 契約（ON/OFF・台数）、テーブルQR、端末の一覧（承認待ち・承認済み・解除）
 *   - 全店舗の承認待ち（/admin/devices）
 * migration 00104 の前は承認の列を読まない（全部「承認済み」として出す）。00103 の前はディスプレイ端末の一覧は空。
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface AdminDeviceRow {
  id: string;
  type: DeviceType;
  storeId: string;
  name: string;
  status: 'active' | 'revoked';
  approval: ApprovalStatus;
  /** 機種・種類・IP など */
  detail: string;
  createdAt: string | null;
  lastSeenAt: string | null;
}

export interface StoreDeviceControlData {
  storeId: string;
  storeName: string;
  organizationId: string;
  /** migration 00104（承認・契約 ON/OFF）が適用済み */
  ready: boolean;
  /** 契約（store_access_policies の行）があるか。無い店舗はレジの台数・承認を数えない */
  contractExists: boolean;
  register: { enabled: boolean; limit: number; counted: boolean };
  handy: { enabled: boolean; limit: number; counted: boolean };
  display: { enabled: boolean; reason: DisplayMonitorFlagReason; limit: number; counted: boolean };
  qr: { on: boolean; reason: QrOrderFlagReason; storeEnabled: boolean | null; tableReady: boolean };
  devices: AdminDeviceRow[];
}

type Rows = { rows: (Record<string, unknown> & { approval: ApprovalStatus })[]; error: unknown };

function registerRows(storeIdOrNull: string | null, admin: Admin, pendingOnly: boolean): Promise<Rows> {
  return selectDevicesWithApproval((columns) => {
    let q = admin.from('register_devices').select(columns);
    if (storeIdOrNull) q = q.eq('store_id', storeIdOrNull);
    if (pendingOnly) q = q.eq('approval_status', 'pending').eq('status', 'active');
    return q.order('created_at', { ascending: false }).limit(200);
  }, 'id, store_id, name, user_agent, first_ip, last_seen_at, status, created_at');
}

function handyRows(storeIdOrNull: string | null, admin: Admin, pendingOnly: boolean): Promise<Rows> {
  return selectDevicesWithApproval((columns) => {
    let q = admin.from('handy_devices').select(columns);
    if (storeIdOrNull) q = q.eq('store_id', storeIdOrNull);
    if (pendingOnly) q = q.eq('approval_status', 'pending').eq('status', 'active');
    return q.order('paired_at', { ascending: false }).limit(200);
  }, 'id, store_id, name, user_agent, paired_ip, last_seen_at, status, paired_at');
}

function displayRows(storeIdOrNull: string | null, admin: Admin, pendingOnly: boolean): Promise<Rows> {
  return selectDevicesWithApproval((columns) => {
    let q = admin.from('display_devices').select(columns);
    if (storeIdOrNull) q = q.eq('store_id', storeIdOrNull);
    if (pendingOnly) q = q.eq('approval_status', 'pending').eq('status', 'active');
    return q.order('paired_at', { ascending: false }).limit(200);
  }, 'id, store_id, name, kind, user_agent, last_ip, last_seen_at, status, paired_at');
}

function toRows(type: DeviceType, res: Rows): AdminDeviceRow[] {
  if (res.error) return [];
  return res.rows.map((r) => {
    const ua = (r.user_agent as string | null) ?? null;
    const ip = ((type === 'register' ? r.first_ip : type === 'handy' ? r.paired_ip : r.last_ip) as string | null) ?? null;
    const kind = type === 'display' && isDisplayKind(r.kind) ? DISPLAY_KIND_LABELS[r.kind] : null;
    return {
      id: r.id as string,
      type,
      storeId: r.store_id as string,
      name: ((r.name as string | null) ?? '').trim() || (type === 'register' ? 'レジ端末' : '端末'),
      status: r.status === 'active' ? 'active' : 'revoked',
      approval: r.approval,
      detail: [kind, deviceModelFromUserAgent(ua), ip].filter(Boolean).join('・'),
      createdAt: ((type === 'register' ? r.created_at : r.paired_at) as string | null) ?? null,
      lastSeenAt: (r.last_seen_at as string | null) ?? null,
    };
  });
}

/** 店舗ごとの「端末の契約と承認」 */
export async function loadStoreDeviceControl(storeId: string): Promise<StoreDeviceControlData | null> {
  const admin = createAdminClient();
  const { data: store } = await admin.from('stores').select('id, name, organization_id').eq('id', storeId).maybeSingle();
  if (!store) return null;
  const organizationId = store.organization_id as string;
  const ready = await deviceControlReady(admin);
  const policy = await loadStorePolicy(storeId);
  const [contract, displayFlag, qrFlag, qrStoreRow, reg, handy, display] = await Promise.all([
    loadContractColumns(admin, storeId, ready && policy.exists),
    loadDisplayMonitorFlag(organizationId, storeId, admin),
    loadQrOrderFlag(organizationId, storeId, admin),
    admin.from('store_feature_flags').select('enabled').eq('store_id', storeId).eq('flag_key', 'qr_order').maybeSingle(),
    registerRows(storeId, admin, false),
    handyRows(storeId, admin, false),
    displayRows(storeId, admin, false),
  ]);
  const qrTableMissing = !!qrStoreRow.error && isMissingTableError(qrStoreRow.error, 'store_feature_flags');
  return {
    storeId,
    storeName: (store.name as string) ?? '',
    organizationId,
    ready,
    contractExists: policy.exists,
    register: { enabled: contract.registerEnabled, limit: policy.registerLimit, counted: countsRegisterDevices(policy) },
    handy: { enabled: contract.handyEnabled, limit: policy.handyLimit, counted: policy.exists && policy.handyLimit > 0 },
    display: {
      enabled: displayFlag.on,
      reason: displayFlag.reason,
      limit: contract.displayLimit,
      counted: ready && policy.exists && contract.displayLimit > 0,
    },
    qr: {
      on: qrFlag.on,
      reason: qrFlag.reason,
      storeEnabled: qrStoreRow.error || !qrStoreRow.data ? null : qrStoreRow.data.enabled === true,
      tableReady: !qrTableMissing,
    },
    devices: [...toRows('register', reg), ...toRows('handy', handy), ...toRows('display', display)],
  };
}

export interface PendingDeviceRow extends AdminDeviceRow {
  storeName: string;
  organizationName: string;
}

/** 全店舗の承認待ち（新しい順）。migration 00104 の前は空（ready = false） */
export async function loadPendingDevices(): Promise<{ ready: boolean; rows: PendingDeviceRow[] }> {
  const admin = createAdminClient();
  const ready = await deviceControlReady(admin);
  if (!ready) return { ready, rows: [] };
  const [reg, handy, display] = await Promise.all([registerRows(null, admin, true), handyRows(null, admin, true), displayRows(null, admin, true)]);
  const rows = [...toRows('register', reg), ...toRows('handy', handy), ...toRows('display', display)].filter((r) => r.approval === 'pending');
  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const names = new Map<string, { store: string; org: string }>();
  if (storeIds.length > 0) {
    const { data: stores } = await admin.from('stores').select('id, name, organizations(name)').in('id', storeIds);
    for (const s of stores ?? []) {
      const org = s.organizations as unknown as { name?: string } | null;
      names.set(s.id as string, { store: (s.name as string) ?? '', org: org?.name ?? '' });
    }
  }
  const order = new Map(DEVICE_TYPES.map((t, i) => [t, i]));
  return {
    ready,
    rows: rows
      .map((r) => ({ ...r, storeName: names.get(r.storeId)?.store ?? '', organizationName: names.get(r.storeId)?.org ?? '' }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0)),
  };
}
