import 'server-only';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError } from '@/lib/schema-compat';
import { loadStorePolicy } from '@/lib/store-access-server';
import { DEVICE_MESSAGE, approvalModeFor, decideDeviceJoin, joinBlockMessage } from '@/lib/device-control';
import { countStoreDevices, deviceControlStatus, loadContractColumns } from '@/lib/device-control-server';
import { loadKdsBoard } from '@/lib/kds-server';
import { filterKdsByStations } from '@/lib/display-kds';
import type { KdsOrderGroup, KdsSettings, StationFilter } from '@/components/kitchen/types';
import {
  clientIpFrom,
  DISPLAY_DEVICE_COOKIE,
  DISPLAY_DEVICE_COOKIE_MAX_AGE,
  DISPLAY_PAIRING_FAILURE_MESSAGE,
  displayPairingFailure,
  hashPairingCode,
  isPairingCode,
} from '@/lib/display-pairing';
import {
  DISPLAY_FLAG_MESSAGE,
  DISPLAY_KIND_LABELS,
  DISPLAY_NEXT_STATUS,
  displayScreenOf,
  isDisplayKind,
  normalizeStations,
  stationsLabel,
  type CallBoard,
  type DisplayKind,
  type DisplayKitchenStatus,
  type DisplayNoticeIcon,
  type DisplayStation,
} from '@/lib/display-monitor';
import {
  DEVICE_COLUMNS,
  createDisplayDeviceSession,
  deviceFrom,
  loadCallBoard,
  loadDisplayMonitorFlag,
  requireActiveDisplayDevice,
  resolveDisplayRequest,
  resumeDisplayDeviceSession,
  setDisplayDeviceCookie,
  signInNewDisplayDevice,
  stationsByMenuItem,
} from '@/lib/display-monitor-server';

/**
 * ディスプレイ端末の操作（Web の /display・/display-pair の Server Action と、
 * iPad アプリのネイティブのディスプレイ（app/api/app/v1/display/route.ts）で同じ中身を使う）。
 */

// -------------------------------------------------------------
// ペアリング（QR を読んだ端末を登録してログイン状態にする）
// -------------------------------------------------------------

export interface PairDisplayResult {
  error?: string;
  storeName?: string;
  kindLabel?: string;
  /** TENPO ONE 運営の承認待ちで登録した（画面は承認待ちの案内。承認されると自動で切り替わる） */
  pending?: boolean;
}

/**
 * QRを読み取った端末を、この店舗のディスプレイ（キッチンディスプレイ／呼び出しモニター）として登録し、
 * そのままログイン状態にする（以降ログアウトしない。セッションが切れても端末の鍵 Cookie でつなぎ直す）。
 * Server Action / Route Handler の中だけで呼ぶ（Cookie を書くため）。
 *
 * 呼び出し元は未ログインの他人の端末なので、次をすべて満たすときだけ成立させる（ハンディと同じ）:
 *   - コードの形式が正しい
 *   - 未使用・期限内のQRである
 *   - QRを表示したレジと同じ接続元（＝お店の回線）から来ている
 *   - 運営がこの企業・この店舗でディスプレイ端末を ON にしている
 */
export async function pairDisplayDeviceWithCode(code: string): Promise<PairDisplayResult> {
  if (!isPairingCode(code)) return { error: DISPLAY_PAIRING_FAILURE_MESSAGE.NOT_FOUND };

  const h = await headers();
  const ip = clientIpFrom({ forwardedFor: h.get('x-forwarded-for'), realIp: h.get('x-real-ip') });
  const userAgent = h.get('user-agent')?.slice(0, 200) ?? null;

  // 未ログインからの呼び出しのため、ここだけサービスロールで照合する（検証は下で自前に行う）
  const admin = createAdminClient();
  const { data: pairing, error: pairingErr } = await admin
    .from('display_pairings')
    .select('id, organization_id, store_id, issued_ip, device_name, kind, stations, expires_at, used_at, created_by')
    .eq('code_hash', hashPairingCode(code))
    .maybeSingle();
  if (pairingErr && isMissingTableError(pairingErr, 'display_pairings')) return { error: DISPLAY_FLAG_MESSAGE.not_ready };

  const failure = displayPairingFailure(
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
  if (failure || !pairing) return { error: DISPLAY_PAIRING_FAILURE_MESSAGE[failure ?? 'NOT_FOUND'] };

  const { data: store } = await admin
    .from('stores')
    .select('id, name, organization_id, status')
    .eq('id', pairing.store_id as string)
    .maybeSingle();
  if (!store || store.status !== 'active' || store.organization_id !== pairing.organization_id) {
    return { error: 'この店舗は現在利用できません。管理者にご連絡ください' };
  }

  const flag = await loadDisplayMonitorFlag(store.organization_id as string, store.id as string, admin);
  if (!flag.on) return { error: DISPLAY_FLAG_MESSAGE[flag.reason === 'on' ? 'company_off' : flag.reason] };

  // コントロールセンター（2026-10-25・migration 00104 の後）: 契約台数まで・運営が承認するまで画面を出さない
  const gate = await displayPairGate(admin, store.id as string);
  if ('error' in gate) return { error: gate.error };

  const kind: DisplayKind = isDisplayKind(pairing.kind) ? pairing.kind : 'kitchen';
  const stations = normalizeStations(pairing.stations);
  const created = await createDisplayDeviceSession(admin, {
    organizationId: store.organization_id as string,
    storeId: store.id as string,
    deviceName: pairing.device_name as string,
    kind,
    stations,
    ip,
    userAgent,
    createdBy: (pairing.created_by as string | null) ?? null,
    pending: gate.pending,
    autoApproved: gate.autoApproved,
  });
  if (created.error || !created.deviceId || !created.profileId || !created.token) {
    return { error: created.error ?? '端末の登録に失敗しました' };
  }
  const profileId = created.profileId;

  // QRは1回限り。先に使用済みにしてから、ログイン状態を渡す
  const { data: consumed } = await admin
    .from('display_pairings')
    .update({ used_at: new Date().toISOString(), device_id: created.deviceId })
    .eq('id', pairing.id as string)
    .is('used_at', null)
    .select('id');
  if (!consumed || consumed.length === 0) {
    // ほぼ同時に別の端末が使った場合。作りかけの端末を残さない
    await admin.from('display_devices').delete().eq('id', created.deviceId);
    await admin.auth.admin.deleteUser(profileId).catch(() => undefined);
    return { error: DISPLAY_PAIRING_FAILURE_MESSAGE.USED };
  }

  const signed = await signInNewDisplayDevice(admin, profileId);
  if (signed.error) return { error: signed.error };
  // セッションが切れても自動でつなぎ直すための端末の鍵（httpOnly・400日）
  await setDisplayDeviceCookie(created.token, DISPLAY_DEVICE_COOKIE_MAX_AGE);

  await admin.rpc('log_audit', {
    p_org: store.organization_id as string,
    p_store: store.id as string,
    p_action: 'display.device_pair',
    p_target_table: 'display_devices',
    p_target_id: created.deviceId,
    p_before: null,
    p_after: { name: pairing.device_name, kind, stations, ip, ...(gate.pending ? { approval_status: 'pending' } : {}) },
    p_note: gate.pending ? '新しいディスプレイ端末。TENPO ONE 運営の承認待ち' : null,
  });

  return { storeName: store.name as string, kindLabel: DISPLAY_KIND_LABELS[kind], ...(gate.pending ? { pending: true } : {}) };
}

/**
 * 新しいディスプレイ端末を作ってよいか（コントロールセンター）。
 * migration 00104 の前は今まで通り（承認なし・台数なし）。後は 運営が決めた台数（未設定＝数えない）まで作り、
 * 承認制を ON にした店舗（移行期間のあと）だけ承認待ちで作る。移行期間は自動承認の印（approved_at）を付ける。
 */
async function displayPairGate(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string
): Promise<{ pending: boolean; autoApproved: boolean } | { error: string }> {
  const status = await deviceControlStatus(admin);
  if (status === 'missing') return { pending: false, autoApproved: false };
  // 列があるのに確かめられない（通信など）：承認なしで端末を作らない
  if (status === 'error') return { error: DEVICE_MESSAGE.retry };
  const policy = await loadStorePolicy(storeId);
  const contract = await loadContractColumns(admin, storeId, policy.exists);
  const mode = approvalModeFor('display', { ready: true, countsRegister: false, contract, now: Date.now() });
  const counts = await countStoreDevices(admin, 'display', storeId, true);
  const decision = decideDeviceJoin({
    // 契約の ON/OFF は display_monitor の機能フラグ（上で確かめ済み）
    contractEnabled: true,
    approvalRequired: mode === 'on',
    known: null,
    approvedActive: counts.approvedActive,
    pending: counts.pending,
    limit: contract.displayLimit,
    reactivatable: false,
  });
  if (decision.kind === 'request') return { pending: true, autoApproved: false };
  if (decision.kind === 'create') return { pending: false, autoApproved: mode === 'transition' };
  return { error: joinBlockMessage('display', decision) ?? '端末の登録に失敗しました' };
}

// -------------------------------------------------------------
// キッチンの操作（/app/kitchen と同じ動き。端末・店・機能 ON・お店の回線を確かめてから）
// -------------------------------------------------------------

/**
 * 端末の持ち場（stations。空＝すべて）の品目だけを残す。持ち場は KDS と同じ決め方
 * （menu_categories.station。未設定は kitchen。lib/display-monitor-server.ts の stationsByMenuItem）
 */
async function keepDeviceStations<T extends { menu_item_id?: unknown }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stations: readonly DisplayStation[],
  rows: T[]
): Promise<T[]> {
  if (stations.length === 0 || rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.menu_item_id).filter((v): v is string => typeof v === 'string'))];
  const byItem = await stationsByMenuItem(supabase, ids);
  const wanted = new Set<string>(stations);
  return rows.filter((r) => typeof r.menu_item_id === 'string' && wanted.has(byItem.get(r.menu_item_id) ?? 'kitchen'));
}

const TIMESTAMP_COLUMN: Record<'preparing' | 'ready' | 'served', 'kitchen_started_at' | 'kitchen_ready_at' | 'served_at'> = {
  preparing: 'kitchen_started_at',
  ready: 'kitchen_ready_at',
  served: 'served_at',
};

/**
 * ディスプレイ（キッチン）で品目を次の段階へ（未着手→調理中→完成→提供済）。/app/kitchen と同じ動き。
 * ディスプレイ端末のアカウントは lib/auth.ts で役割が無い扱い（requirePermission は全部断る）ので、
 * 厨房の操作だけはここで「この端末・この店の品目・機能 ON・お店の回線」を確かめてから行う。
 */
export async function advanceDisplayItem(orderItemId: string, nextStatus: DisplayKitchenStatus): Promise<void> {
  const { device, supabase } = await requireActiveDisplayDevice();
  if (device.kind !== 'kitchen') throw new Error('この端末では操作できません');

  const { data: item } = await supabase
    .from('order_items')
    .select('id, store_id, menu_item_id, kitchen_status, status')
    .eq('id', orderItemId)
    .eq('store_id', device.storeId)
    .maybeSingle();
  if (!item) throw new Error('品目が見つかりません');
  if (item.status !== 'active') throw new Error('この品目は取消済みです');
  const [allowed] = await keepDeviceStations(supabase, device.stations, [item]);
  if (!allowed) throw new Error('この端末の持ち場の品目ではありません');

  const current = item.kitchen_status as DisplayKitchenStatus;
  if (nextStatus === 'pending' || DISPLAY_NEXT_STATUS[current] !== nextStatus) throw new Error('この状態遷移はできません');

  const column = TIMESTAMP_COLUMN[nextStatus];
  const { error } = await supabase
    .from('order_items')
    .update({ kitchen_status: nextStatus, [column]: new Date().toISOString(), updated_by: device.profileId })
    .eq('id', orderItemId)
    .eq('store_id', device.storeId);
  if (error) throw new Error(error.message);
}

/**
 * カード単位で未提供の品目をまとめて提供済に（/app/kitchen の「すべて提供済にする」と同じ）。
 * onlyItemIds は画面に出ている品目（持ち場で絞った分）だけ。
 */
export async function markDisplayOrderServed(orderId: string, onlyItemIds?: string[]): Promise<void> {
  const { device, supabase } = await requireActiveDisplayDevice();
  if (device.kind !== 'kitchen') throw new Error('この端末では操作できません');

  const { data: order } = await supabase.from('orders').select('id, store_id').eq('id', orderId).eq('store_id', device.storeId).maybeSingle();
  if (!order) throw new Error('注文が見つかりません');

  let query = supabase
    .from('order_items')
    .select('id, menu_item_id, kitchen_status, kitchen_started_at, kitchen_ready_at')
    .eq('order_id', orderId)
    .eq('store_id', device.storeId)
    .eq('status', 'active')
    .neq('kitchen_status', 'served');
  if (onlyItemIds && onlyItemIds.length > 0) query = query.in('id', onlyItemIds.slice(0, 200));
  const { data: rows } = await query;
  // 持ち場を決めた端末（例: ドリンクだけ）は、ほかの持ち場の品目を提供済にしない（画面に出ていない品目のため）
  const items = await keepDeviceStations(supabase, device.stations, rows ?? []);
  if (items.length === 0) return;

  const now = new Date().toISOString();
  await Promise.all(
    items.map((it) =>
      supabase
        .from('order_items')
        .update({
          kitchen_status: 'served',
          kitchen_started_at: it.kitchen_started_at ?? now,
          kitchen_ready_at: it.kitchen_ready_at ?? now,
          served_at: now,
          updated_by: device.profileId,
        })
        .eq('id', it.id)
        .eq('store_id', device.storeId)
    )
  );
}

// -------------------------------------------------------------
// この端末をディスプレイからはずす（iPad アプリの「この iPad をレジに戻す」）
// -------------------------------------------------------------

/**
 * ディスプレイとしてつないだ端末が、自分で解除してログアウトする（店の設定の「解除」と同じ結果）。
 * ほかの端末・アカウントには触らない。Server Action / Route Handler の中だけで呼ぶ（Cookie を消すため）。
 */
export async function leaveDisplayDevice(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const jar = await cookies();
  if (user && user.app_metadata?.display_device === true) {
    const admin = createAdminClient();
    const { data: row } = await admin.from('display_devices').select(DEVICE_COLUMNS).eq('profile_id', user.id).maybeSingle();
    if (row) {
      const device = deviceFrom(row);
      if (device.status === 'active') {
        const at = new Date().toISOString();
        await admin
          .from('display_devices')
          .update({ status: 'revoked', revoked_at: at, revoked_by: user.id, device_token_hash: null, updated_at: at })
          .eq('id', device.id);
        await suspendDisplayAccount(admin, device.profileId);
        await admin.rpc('log_audit', {
          p_org: device.organizationId,
          p_store: device.storeId,
          p_action: 'display.device_leave',
          p_target_table: 'display_devices',
          p_target_id: device.id,
          p_before: { status: 'active' },
          p_after: { status: 'revoked', name: device.name },
          p_note: '端末の画面から解除（レジに戻す）',
        });
      }
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
  jar.set(DISPLAY_DEVICE_COOKIE, '', { path: '/', maxAge: 0 });
  return { ok: true };
}

/**
 * 解除した端末のアカウントを止める：所属を停止し、ログインの更新もできないようにする（ban）。
 * ディスプレイ端末の専用アカウント（app_metadata.display_device）以外には何もしない。
 */
export async function suspendDisplayAccount(admin: ReturnType<typeof createAdminClient>, profileId: string): Promise<void> {
  const { data } = await admin.auth.admin.getUserById(profileId);
  if (data?.user?.app_metadata?.display_device !== true) return;
  await admin.from('memberships').update({ status: 'suspended' }).eq('profile_id', profileId);
  await admin.auth.admin.updateUserById(profileId, { ban_duration: '876000h' }).catch(() => undefined);
}

// -------------------------------------------------------------
// iPad アプリのネイティブのディスプレイ（GET /api/app/v1/display）
// -------------------------------------------------------------

export interface DisplayAppPayload {
  ok: true;
  screen: 'notice' | 'board';
  notice: { icon: DisplayNoticeIcon; title: string; body: string | null; footer: string | null } | null;
  /** 次に読み直すまでの秒数 */
  refreshSec: number;
  /** 数分ごとの見守り（POST heartbeat）を送るか */
  heartbeat: boolean;
  /** サーバーの時刻（ミリ秒。経過時間の基準） */
  now: number;
  store: { id: string; name: string } | null;
  device: { id: string; name: string; kind: DisplayKind; kindLabel: string; stations: DisplayStation[]; stationsLabel: string } | null;
  kitchen: {
    groups: KdsOrderGroup[];
    unservedCount: number;
    avgElapsedMinutes: number;
    kdsSettings: KdsSettings;
    stationOptions: StationFilter[];
  } | null;
  call: CallBoard | null;
}

const BOARD_REFRESH_SEC: Record<DisplayKind, number> = { kitchen: 8, call: 5 };

/**
 * ネイティブのディスプレイの中身（Web の /display と同じ判定・同じ読み込み）。
 * セッションが切れた端末は、ここで端末の鍵でつなぎ直す（ログイン状態は Set-Cookie で返し、次の読み込みから使う）。
 * 例外は投げない（画面を落とさない）。
 */
export async function loadDisplayScreenForApp(): Promise<DisplayAppPayload> {
  const base = { ok: true as const, now: Date.now(), store: null, device: null, kitchen: null, call: null };
  const state = await resolveDisplayRequest();
  const screen = displayScreenOf(state);

  if (screen.screen === 'resume') {
    const r = await resumeDisplayDeviceSession().catch(() => ({ ok: false, error: undefined as string | undefined }));
    return {
      ...base,
      screen: 'notice',
      notice: { icon: 'loading', title: 'つなぎ直しています…', body: r.ok ? 'このままお待ちください' : (r.error ?? 'このままお待ちください（ログアウトはしていません）'), footer: null },
      refreshSec: r.ok ? 1 : 15,
      heartbeat: false,
    };
  }
  if (screen.screen === 'notice') {
    const store = state.kind === 'ready' ? { id: state.device.storeId, name: state.storeName } : null;
    return {
      ...base,
      store,
      screen: 'notice',
      notice: { icon: screen.icon, title: screen.title, body: screen.body, footer: screen.footer },
      // 解除済み・未登録はゆっくり見直す（店の設定でつなぎ直したときに戻れるよう）
      refreshSec: Math.round((screen.refreshMs ?? 60_000) / 1000),
      heartbeat: screen.heartbeat,
    };
  }
  if (state.kind !== 'ready') return { ...base, screen: 'notice', notice: { icon: 'loading', title: '接続を確認しています…', body: null, footer: null }, refreshSec: 10, heartbeat: false };

  const { device, storeName } = state;
  const deviceOut = {
    id: device.id,
    name: device.name,
    kind: device.kind,
    kindLabel: DISPLAY_KIND_LABELS[device.kind],
    stations: device.stations,
    stationsLabel: stationsLabel(device.stations),
  };
  const out = { ...base, store: { id: device.storeId, name: storeName }, device: deviceOut, screen: 'board' as const, notice: null, refreshSec: BOARD_REFRESH_SEC[device.kind], heartbeat: true };
  try {
    const supabase = await createClient();
    if (device.kind === 'call') {
      return { ...out, call: await loadCallBoard(supabase, device.storeId, device.stations) };
    }
    const kds = await loadKdsBoard(supabase, { id: device.storeId });
    const view = filterKdsByStations(kds.groups, device.stations, kds.now);
    return {
      ...out,
      now: kds.now,
      kitchen: { groups: view.groups, unservedCount: view.unservedCount, avgElapsedMinutes: view.avgElapsedMinutes, kdsSettings: kds.kdsSettings, stationOptions: view.stationOptions },
    };
  } catch (e) {
    console.error('[display] app board failed', e instanceof Error ? e.message : e);
    return { ...base, screen: 'notice', notice: { icon: 'loading', title: '接続を確認しています…', body: 'このままお待ちください（ログアウトはしていません）', footer: null }, refreshSec: 10, heartbeat: false };
  }
}
