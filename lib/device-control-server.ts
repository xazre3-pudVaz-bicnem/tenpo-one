import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingColumnError, isMissingTableError } from '@/lib/schema-compat';
import {
  DEFAULT_CONTRACT_COLUMNS,
  DEVICE_TABLES,
  PENDING_CAP_WINDOW_MS,
  approvalFrom,
  contractColumnsFrom,
  type ApprovalStatus,
  type DeviceContractColumns,
  type DeviceType,
} from '@/lib/device-control';

/**
 * 端末の契約と承認（lib/device-control.ts）の DB まわり。
 * migration 00104 の列がまだ無い間は、すべて今まで通り（承認なし・契約は ON）に倒す
 * （lib/schema-compat.ts と同じく「列が無い」エラーだけを見分ける）。
 * 列があるのに読めなかった（通信など）ときは、端末を作る処理は「もう一度お試しください」で止める（承認なしで作らない）。
 */

type Admin = ReturnType<typeof createAdminClient>;
type DbError = { message?: string | null; code?: string | null } | null | undefined;

/** migration 00104 で足した列 */
const NEW_COLUMNS = [
  'approval_status',
  'approved_at',
  'approved_by',
  'approval_requested_at',
  'register_enabled',
  'handy_enabled',
  'display_limit',
  'register_approval_since',
  'handy_approval_since',
  'display_approval_since',
  'device_token_hash',
] as const;

export const CONTRACT_COLUMNS = 'register_enabled, handy_enabled, display_limit, register_approval_since, handy_approval_since, display_approval_since';

/** migration 00104（・00103 の display_devices）がまだ無いことによるエラーか */
export function isMissingDeviceControlSchema(error: DbError): boolean {
  if (!error) return false;
  return NEW_COLUMNS.some((c) => isMissingColumnError(error.message ?? null, c)) || isMissingTableError(error, 'display_devices');
}

export type DeviceControlStatus =
  /** migration 00104 が適用済み */
  | 'ready'
  /** 列が無い（未適用）＝今まで通り */
  | 'missing'
  /** 確かめられなかった（通信など）。端末を作る処理は止める */
  | 'error';

let readyKnown = false;
let missingAt = 0;
const RECHECK_MS = 60_000;

/** テスト用：覚えている「適用済みか」を忘れる */
export function resetDeviceControlSchemaCache(): void {
  readyKnown = false;
  missingAt = 0;
}

/**
 * migration 00104 が適用済みか（4つの表の新しい列を読んでみる。行が無くても列が無ければエラーになる）。
 * 適用済みと分かったらこのサーバーの間は覚えておく。未適用（列が無い）なら 1 分後にまた確かめる。
 * 列が無いのとは別のエラーは覚えずに 'error'（次の呼び出しで確かめ直す）。
 */
export async function deviceControlStatus(admin?: Admin): Promise<DeviceControlStatus> {
  if (readyKnown) return 'ready';
  if (missingAt && Date.now() - missingAt < RECHECK_MS) return 'missing';
  try {
    const client = admin ?? createAdminClient();
    const results = await Promise.all([
      client.from('store_access_policies').select(CONTRACT_COLUMNS).limit(1),
      client.from('register_devices').select('approval_status, approved_at, approved_by, approval_requested_at').limit(1),
      client.from('handy_devices').select('approval_status, approved_at, approved_by, approval_requested_at, device_token_hash').limit(1),
      client.from('display_devices').select('approval_status, approved_at, approved_by, approval_requested_at').limit(1),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) {
      if (isMissingDeviceControlSchema(failed.error)) {
        missingAt = Date.now();
        return 'missing';
      }
      console.error('[device-control] schema check failed', failed.error?.message);
      return 'error';
    }
    readyKnown = true;
    return 'ready';
  } catch (e) {
    console.error('[device-control] schema check failed', e instanceof Error ? e.message : e);
    return 'error';
  }
}

/** 読むだけの処理用：適用済みと分かっているときだけ true（確かめられないときは今まで通りに倒す） */
export async function deviceControlReady(admin?: Admin): Promise<boolean> {
  return (await deviceControlStatus(admin)) === 'ready';
}

/**
 * 店舗の契約の列（レジ・ハンディの ON/OFF、ディスプレイの台数、承認制）。
 * migration の前・契約の行が無い・読めないときは ON・数えない・承認制 OFF（店を止めない）。
 */
export async function loadContractColumns(admin: Admin, storeId: string, ready: boolean): Promise<DeviceContractColumns> {
  if (!ready) return DEFAULT_CONTRACT_COLUMNS;
  const { data, error } = await admin.from('store_access_policies').select(CONTRACT_COLUMNS).eq('store_id', storeId).maybeSingle();
  if (error) {
    if (!isMissingDeviceControlSchema(error)) console.error('[device-control] contract read failed', error.message);
    return DEFAULT_CONTRACT_COLUMNS;
  }
  return contractColumnsFrom(data as Record<string, unknown> | null);
}

/**
 * この店舗・この種類の、使用中かつ承認済みの台数と、最近（24時間）の承認待ちの台数。
 * migration の前は使用中の台数だけ（今まで通り）。
 */
export async function countStoreDevices(
  admin: Admin,
  type: DeviceType,
  storeId: string,
  ready: boolean
): Promise<{ approvedActive: number; pending: number }> {
  const table = DEVICE_TABLES[type];
  if (!ready) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active');
    return { approvedActive: count ?? 0, pending: 0 };
  }
  const since = new Date(Date.now() - PENDING_CAP_WINDOW_MS).toISOString();
  const [approved, pending] = await Promise.all([
    admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'active')
      .eq('approval_status', 'approved'),
    admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'active')
      .eq('approval_status', 'pending')
      .gt('approval_requested_at', since),
  ]);
  return { approvedActive: approved.count ?? 0, pending: pending.count ?? 0 };
}

/** 1台の承認の状態。列が無い（migration の前）・読めないときは承認済み（止めない） */
export async function readDeviceApproval(admin: Admin, type: DeviceType, deviceId: string): Promise<ApprovalStatus> {
  try {
    if (!(await deviceControlReady(admin))) return 'approved';
    const { data, error } = await admin.from(DEVICE_TABLES[type]).select('approval_status').eq('id', deviceId).maybeSingle();
    if (error) return 'approved';
    return approvalFrom((data as { approval_status?: unknown } | null)?.approval_status);
  } catch {
    return 'approved';
  }
}

export interface ApprovalFields {
  approval: ApprovalStatus;
  approvedAt: string | null;
  approvedBy: string | null;
}

/**
 * 一覧を読む（承認の列があれば一緒に読む。無ければ（migration の前）列を外して読み直し、承認済みとして返す）。
 * columns には承認の列を入れない（ここで足す）。
 */
export async function selectDevicesWithApproval<T extends Record<string, unknown>>(
  run: (columns: string) => PromiseLike<{ data: unknown; error: DbError }>,
  columns: string
): Promise<{ rows: (T & ApprovalFields)[]; error: DbError; ready: boolean }> {
  const first = await run(`${columns}, approval_status, approved_at, approved_by`);
  if (!first.error) {
    const rows = ((first.data as T[] | null) ?? []).map((r) => {
      const o = r as Record<string, unknown>;
      return {
        ...r,
        approval: approvalFrom(o.approval_status),
        approvedAt: (o.approved_at as string | null) ?? null,
        approvedBy: (o.approved_by as string | null) ?? null,
      };
    });
    return { rows, error: null, ready: true };
  }
  if (!isMissingDeviceControlSchema(first.error)) return { rows: [], error: first.error, ready: false };
  const second = await run(columns);
  const rows = ((second.data as T[] | null) ?? []).map((r) => ({ ...r, approval: 'approved' as ApprovalStatus, approvedAt: null, approvedBy: null }));
  return { rows, error: second.error ?? null, ready: false };
}

// -------------------------------------------------------------
// ハンディの「端末の鍵」（Cookie。DB にはハッシュだけ）
// -------------------------------------------------------------

export function generateDeviceToken(): string {
  return randomBytes(24).toString('hex');
}

export function hashHandyDeviceToken(token: string): string {
  return createHash('sha256').update(`handy-device:${token.toLowerCase()}`).digest('hex');
}
