import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingColumnError, isMissingTableError } from '@/lib/schema-compat';
import { currentRequestIp, loadHandyQr } from '@/lib/handy-device-server';
import { loadStorePolicy } from '@/lib/store-access-server';
import { isAllowedNetwork, isRestricted } from '@/lib/store-access';
import { isShopNetwork, isWifiGuarded } from '@/lib/handy-qr';
import {
  DISPLAY_DEVICE_COOKIE,
  DISPLAY_DEVICE_COOKIE_MAX_AGE,
  displayDeviceEmail,
  generateDisplayDeviceToken,
  hashDisplayDeviceToken,
  isDisplayDeviceToken,
} from '@/lib/display-pairing';
import {
  DISPLAY_FLAG_MESSAGE,
  DISPLAY_KIND_LABELS,
  DISPLAY_KINDS,
  DISPLAY_MONITOR_FLAG,
  DISPLAY_STATION_LABELS,
  DISPLAY_STATIONS,
  buildCallBoard,
  deviceModelFromUserAgent,
  displayNetworkAllowed,
  isDisplayKind,
  normalizeStations,
  resolveDisplayMonitorFlag,
  shouldTouchLastSeen,
  stationsLabel,
  type CallBoard,
  type CallBoardOrderInput,
  type CallKitchenStatus,
  type DisplayDevice,
  type DisplayDevicesPayload,
  type DisplayKind,
  type DisplayMonitorFlagState,
  type DisplayRequestState,
  type DisplayStation,
} from '@/lib/display-monitor';

import { DEVICE_MESSAGE } from '@/lib/device-control';
import { readDeviceApproval, selectDevicesWithApproval } from '@/lib/device-control-server';

export type { DisplayDevice, DisplayRequestState } from '@/lib/display-monitor';

type Admin = ReturnType<typeof createAdminClient>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export const DEVICE_COLUMNS = 'id, organization_id, store_id, name, kind, stations, profile_id, status, last_seen_at';

export function deviceFrom(row: Record<string, unknown>): DisplayDevice {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    storeId: row.store_id as string,
    name: (row.name as string) ?? '',
    kind: isDisplayKind(row.kind) ? row.kind : 'kitchen',
    stations: normalizeStations(row.stations),
    profileId: row.profile_id as string,
    status: row.status === 'active' ? 'active' : 'revoked',
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
  };
}

// -------------------------------------------------------------
// 機能の ON/OFF（企業 × 店舗。既定 OFF）
// -------------------------------------------------------------

/** 企業の display_monitor（feature_flags に enabled=true の行があるか）。読めなければ null（＝OFF） */
async function readOrgFlag(admin: Admin, organizationId: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from('feature_flags')
    .select('enabled')
    .eq('organization_id', organizationId)
    .eq('flag_key', DISPLAY_MONITOR_FLAG)
    .maybeSingle();
  if (error || !data) return null;
  return data.enabled === true;
}

/**
 * この店でディスプレイ端末を使えるか（企業と店舗の両方が ON のときだけ）。
 * 店舗の表（store_feature_flags）がまだ無い＝ migration 00103 未適用なら not_ready（OFF）。
 * どんな失敗でも例外にせず OFF を返す（画面を落とさない）。
 */
export async function loadDisplayMonitorFlag(organizationId: string, storeId: string, preAdmin?: Admin): Promise<DisplayMonitorFlagState> {
  try {
    const admin = preAdmin ?? createAdminClient();
    const orgEnabled = await readOrgFlag(admin, organizationId);
    if (orgEnabled !== true) return resolveDisplayMonitorFlag({ orgEnabled, storeEnabled: null });
    const { data, error } = await admin
      .from('store_feature_flags')
      .select('enabled')
      .eq('store_id', storeId)
      .eq('flag_key', DISPLAY_MONITOR_FLAG)
      .maybeSingle();
    if (error) {
      if (!isMissingTableError(error, 'store_feature_flags')) console.error('[display] store flag read failed', error.message);
      return resolveDisplayMonitorFlag({ orgEnabled, storeEnabled: null, storeTableMissing: isMissingTableError(error, 'store_feature_flags') });
    }
    return resolveDisplayMonitorFlag({ orgEnabled, storeEnabled: data ? data.enabled === true : null });
  } catch (e) {
    console.error('[display] flag read failed', e instanceof Error ? e.message : e);
    return { on: false, reason: 'company_off' };
  }
}

/** 同じリクエストの中では1回だけ読む（設定の枠と中のページの両方が聞くため） */
const displayMonitorOnCached = cache(async (organizationId: string, storeId: string): Promise<boolean> => {
  return (await loadDisplayMonitorFlag(organizationId, storeId)).on;
});

/** 設定の一覧（デバイス管理）に「ディスプレイ端末」を出すか。今選んでいる店で ON のときだけ */
export async function isDisplayMonitorOnForSettings(ctx: {
  organizationId: string | null;
  currentStore: { id: string } | null;
  stores: { id: string }[];
}): Promise<boolean> {
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  if (!ctx.organizationId || !store) return false;
  return displayMonitorOnCached(ctx.organizationId, store.id);
}

/** 運営コンソール用：企業の値と店舗ごとの値（店舗の表が無ければ storeTableMissing） */
export async function loadOrgDisplayMonitorFlags(organizationId: string): Promise<{
  orgEnabled: boolean;
  storeEnabled: Map<string, boolean>;
  storeTableMissing: boolean;
  /** 店舗ごとのつないでいる端末の数（表が無ければ空） */
  activeDevices: Map<string, number>;
}> {
  const admin = createAdminClient();
  const [orgFlag, flagsRes, devicesRes] = await Promise.all([
    readOrgFlag(admin, organizationId),
    admin.from('store_feature_flags').select('store_id, enabled').eq('organization_id', organizationId).eq('flag_key', DISPLAY_MONITOR_FLAG),
    admin.from('display_devices').select('store_id').eq('organization_id', organizationId).eq('status', 'active'),
  ]);
  const activeDevices = new Map<string, number>();
  for (const d of devicesRes.error ? [] : (devicesRes.data ?? [])) {
    const id = d.store_id as string;
    activeDevices.set(id, (activeDevices.get(id) ?? 0) + 1);
  }
  const orgEnabled = orgFlag === true;
  if (flagsRes.error) {
    return { orgEnabled, storeEnabled: new Map(), storeTableMissing: isMissingTableError(flagsRes.error, 'store_feature_flags'), activeDevices };
  }
  return {
    orgEnabled,
    storeEnabled: new Map((flagsRes.data ?? []).map((r) => [r.store_id as string, r.enabled === true])),
    storeTableMissing: false,
    activeDevices,
  };
}

// -------------------------------------------------------------
// お店の回線（ログアウトはしない。外なら画面に案内を出すだけ）
// -------------------------------------------------------------

/**
 * この接続元がお店の回線か（ハンディの checkHandyNetwork と同じ「お店の回線」：
 * 運営が登録して制限している回線＋iPhoneハンディの「お店のWi-Fiだけで使う」で登録した回線）。
 * 回線を登録していない店は判定できないので true。読めないときも true（画面を止めない）。
 */
export async function isDisplayOnStoreNetwork(storeId: string, ip: string | null, preAdmin?: Admin): Promise<boolean> {
  try {
    const admin = preAdmin ?? createAdminClient();
    const [{ qr }, policy] = await Promise.all([loadHandyQr(admin, storeId), loadStorePolicy(storeId)]);
    return displayNetworkAllowed({
      guarded: isWifiGuarded(qr) || isRestricted(policy),
      inside: isShopNetwork(qr, ip) || (isRestricted(policy) && isAllowedNetwork(policy, ip)),
    });
  } catch (e) {
    console.error('[display] network check failed', e instanceof Error ? e.message : e);
    return true;
  }
}

// -------------------------------------------------------------
// 端末のアカウント・セッション（ペアリング・つなぎ直し）
// -------------------------------------------------------------

/** 端末のアカウントでこのブラウザにログイン状態（cookie）を渡す。パスワードは端末に残さない */
async function signInAs(admin: Admin, email: string): Promise<{ error?: string }> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { error: `ログインの準備に失敗しました: ${linkErr?.message ?? '不明なエラー'}` };
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyErr) return { error: `ログインに失敗しました: ${verifyErr.message}` };
  return {};
}

/**
 * ディスプレイ端末（専用アカウント）を作って、この端末にログイン状態を渡す。
 * 権限はいちばん下（アルバイト・この店だけ）。画面の読み込み（注文・厨房の品目）に要るだけで、
 * 設定・会計などの操作は lib/auth.ts の requirePermission がディスプレイ端末を全部断る。
 * 戻り値の token は端末の Cookie に入れる「端末の鍵」（DB にはハッシュだけ）。
 */
export async function createDisplayDeviceSession(
  admin: Admin,
  input: {
    organizationId: string;
    storeId: string;
    deviceName: string;
    kind: DisplayKind;
    stations: DisplayStation[];
    ip: string | null;
    userAgent: string | null;
    createdBy: string | null;
    /** コントロールセンターの承認待ちで作る（migration 00104 の後だけ渡す） */
    pending?: boolean;
  }
): Promise<{ deviceId?: string; profileId?: string; token?: string; error?: string }> {
  const email = displayDeviceEmail(crypto.randomUUID());
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { display_name: `${input.deviceName}（ディスプレイ）` },
    // 端末の印は app_metadata に入れる（本人が書き換えられない。user_metadata は本人が updateUser で消せるため）
    app_metadata: { display_device: true },
  });
  if (createErr || !created?.user) return { error: `端末の登録に失敗しました: ${createErr?.message ?? '不明なエラー'}` };
  const userId = created.user.id;
  const fail = async (msg: string) => {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return { error: `端末の登録に失敗しました: ${msg}` };
  };

  const { data: membership, error: memErr } = await admin
    .from('memberships')
    // 承認待ちの端末は所属を止めておく（注文などのデータを読めない。運営が承認したときに戻す）
    .insert({ organization_id: input.organizationId, profile_id: userId, role: 'part_time', status: input.pending ? 'suspended' : 'active', created_by: input.createdBy })
    .select('id')
    .single();
  if (memErr || !membership) return fail(memErr?.message ?? '不明なエラー');

  const { error: storeErr } = await admin
    .from('membership_stores')
    .insert({ membership_id: membership.id as string, store_id: input.storeId, is_primary: true });
  if (storeErr) return fail(storeErr.message);

  const token = generateDisplayDeviceToken();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    store_id: input.storeId,
    name: input.deviceName,
    kind: input.kind,
    stations: input.stations,
    profile_id: userId,
    membership_id: membership.id as string,
    device_token_hash: hashDisplayDeviceToken(token),
    paired_ip: input.ip,
    last_ip: input.ip,
    user_agent: input.userAgent,
    last_seen_at: now,
    created_by: input.createdBy,
  };
  if (input.pending) Object.assign(row, { approval_status: 'pending', approval_requested_at: now });
  const { data: device, error: deviceErr } = await admin.from('display_devices').insert(row).select('id').single();
  if (deviceErr || !device) return fail(deviceErr?.message ?? '不明なエラー');

  return { deviceId: device.id as string, profileId: userId, token };
}

/** ペアリングで作った端末のアカウントでログインする（QR を使用済みにした後で呼ぶ） */
export async function signInNewDisplayDevice(admin: Admin, profileId: string): Promise<{ error?: string }> {
  const { data, error } = await admin.auth.admin.getUserById(profileId);
  const email = data?.user?.email;
  if (error || !email) return { error: `ログインの準備に失敗しました: ${error?.message ?? '端末のアカウントが見つかりません'}` };
  return signInAs(admin, email);
}

/** 端末の鍵の Cookie（httpOnly・400日）。Server Action / Route Handler の中だけで呼ぶ */
export async function setDisplayDeviceCookie(token: string, maxAge: number): Promise<void> {
  (await cookies()).set(DISPLAY_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/**
 * セッションが切れた端末を、端末の鍵（Cookie）でつなぎ直す（ログアウトさせないため）。
 * 解除された端末・鍵が合わない端末はつながない。
 */
export async function resumeDisplayDeviceSession(): Promise<{ ok: boolean; error?: string }> {
  const raw = (await cookies()).get(DISPLAY_DEVICE_COOKIE)?.value;
  if (!isDisplayDeviceToken(raw)) return { ok: false, error: 'この端末は登録されていません' };
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('display_devices')
    .select(DEVICE_COLUMNS)
    .eq('device_token_hash', hashDisplayDeviceToken(raw))
    .maybeSingle();
  if (error) return { ok: false, error: '接続を確認しています。しばらくお待ちください' };
  if (!row) return { ok: false, error: 'この端末は登録されていません' };
  const device = deviceFrom(row);
  if (device.status !== 'active') return { ok: false, error: 'この端末は解除されました' };
  const signed = await signInNewDisplayDevice(admin, device.profileId);
  if (signed.error) return { ok: false, error: signed.error };
  await admin.rpc('log_audit', {
    p_org: device.organizationId,
    p_store: device.storeId,
    p_action: 'display.device_resume',
    p_target_table: 'display_devices',
    p_target_id: device.id,
    p_before: null,
    p_after: { name: device.name },
    p_note: 'セッションが切れたため、端末の鍵で自動でつなぎ直し',
  });
  return { ok: true };
}

// -------------------------------------------------------------
// /display の判定（どの画面を出すか。画面の決め方は lib/display-monitor.ts の displayScreenOf）
// -------------------------------------------------------------

function isAuthFailure(error: { status?: number }): boolean {
  const status = error.status ?? 0;
  return status === 400 || status === 401 || status === 403;
}

/**
 * /display を開いた端末がどの状態か。例外は投げない（画面を落とさない）。
 * つないだ端末は「使用中」の記録（last_seen_at）もここで更新する（1分に1回まで）。
 */
export async function resolveDisplayRequest(): Promise<DisplayRequestState> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    const jar = await cookies();
    if (!user && error && !isAuthFailure(error) && jar.getAll().some((c) => c.name.startsWith('sb-') && !!c.value)) {
      return { kind: 'transient' };
    }
    const admin = createAdminClient();

    if (user && user.app_metadata?.display_device === true) {
      const { data: row, error: rowErr } = await admin.from('display_devices').select(DEVICE_COLUMNS).eq('profile_id', user.id).maybeSingle();
      if (rowErr) return isMissingTableError(rowErr, 'display_devices') ? { kind: 'not_ready' } : { kind: 'transient' };
      if (!row) return { kind: 'revoked', name: null };
      const device = deviceFrom(row);
      if (device.status !== 'active') return { kind: 'revoked', name: device.name };
      // コントロールセンター（migration 00104 の後）: 運営が承認するまで画面を出さない（ログアウトはしない）
      const approval = await readDeviceApproval(admin, 'display', device.id);
      if (approval === 'pending') return await pendingState(admin, device);
      if (approval !== 'approved') return { kind: 'revoked', name: device.name };
      return await readyState(admin, device);
    }

    const raw = jar.get(DISPLAY_DEVICE_COOKIE)?.value;
    if (isDisplayDeviceToken(raw)) {
      const { data: row, error: rowErr } = await admin
        .from('display_devices')
        .select(DEVICE_COLUMNS)
        .eq('device_token_hash', hashDisplayDeviceToken(raw))
        .maybeSingle();
      if (rowErr) return isMissingTableError(rowErr, 'display_devices') ? { kind: 'not_ready' } : { kind: 'transient' };
      if (row) {
        const device = deviceFrom(row);
        return device.status === 'active' ? { kind: 'resume' } : { kind: 'revoked', name: device.name };
      }
    }
    return { kind: 'unpaired', staffSignedIn: !!user };
  } catch (e) {
    console.error('[display] resolve failed', e instanceof Error ? e.message : e);
    return { kind: 'transient' };
  }
}

/** 承認待ちの端末：案内だけ出す（「使用中」の記録は残す＝運営の一覧で最終の通信が分かる） */
async function pendingState(admin: Admin, device: DisplayDevice): Promise<DisplayRequestState> {
  const ip = await currentRequestIp();
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  const [{ data: store }] = await Promise.all([
    admin.from('stores').select('name').eq('id', device.storeId).maybeSingle(),
    touchDisplayDevice(admin, device, ip, ua),
  ]);
  return { kind: 'pending', name: device.name, storeName: (store?.name as string | undefined) ?? '' };
}

async function readyState(admin: Admin, device: DisplayDevice): Promise<DisplayRequestState> {
  const ip = await currentRequestIp();
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  const [{ data: store }, { data: org }, flag, onNetwork] = await Promise.all([
    admin.from('stores').select('name, status').eq('id', device.storeId).maybeSingle(),
    admin.from('organizations').select('status').eq('id', device.organizationId).maybeSingle(),
    loadDisplayMonitorFlag(device.organizationId, device.storeId, admin),
    isDisplayOnStoreNetwork(device.storeId, ip, admin),
  ]);
  await touchDisplayDevice(admin, device, ip, ua);
  // 契約停止の企業・閉じた店舗は「使えません」と同じ扱い（端末は解除しない）
  const orgOk = !org || org.status === 'active' || org.status === 'trial';
  const storeOk = !store || store.status === 'active';
  return {
    kind: 'ready',
    device,
    storeName: (store?.name as string | undefined) ?? '',
    flag: orgOk && storeOk ? flag : { on: false, reason: 'company_off' },
    onNetwork,
  };
}

/** 「使用中」の記録（1分に1回まで書く） */
export async function touchDisplayDevice(admin: Admin, device: DisplayDevice, ip: string | null, userAgent: string | null): Promise<void> {
  if (!shouldTouchLastSeen(device.lastSeenAt, Date.now())) return;
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString(), last_ip: ip };
  if (userAgent) patch.user_agent = userAgent;
  const { error } = await admin.from('display_devices').update(patch).eq('id', device.id);
  if (error) console.error('[display] touch failed', error.message);
}

/**
 * 数分ごとの見守り（Server Action から）：端末の鍵 Cookie の期限を延ばし、「使用中」を記録する。
 * 鍵が無い・合わない（Cookie が消えた等）ときは新しい鍵を入れ直す。回線の外でも解除・ログアウトはしない。
 */
export async function displayHeartbeatServer(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.display_device !== true) return { ok: false };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('display_devices')
    .select(`${DEVICE_COLUMNS}, device_token_hash`)
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!row) return { ok: false };
  const device = deviceFrom(row);
  if (device.status !== 'active') return { ok: false };

  const raw = (await cookies()).get(DISPLAY_DEVICE_COOKIE)?.value;
  if (isDisplayDeviceToken(raw) && hashDisplayDeviceToken(raw) === (row.device_token_hash as string | null)) {
    await setDisplayDeviceCookie(raw, DISPLAY_DEVICE_COOKIE_MAX_AGE);
  } else {
    const token = generateDisplayDeviceToken();
    const { error } = await admin.from('display_devices').update({ device_token_hash: hashDisplayDeviceToken(token) }).eq('id', device.id);
    if (!error) await setDisplayDeviceCookie(token, DISPLAY_DEVICE_COOKIE_MAX_AGE);
  }
  const ip = await currentRequestIp();
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  await touchDisplayDevice(admin, device, ip, ua);
  return { ok: true };
}

/**
 * ディスプレイの操作（Server Action）の入口：この端末のアカウントで、解除されておらず、
 * 機能が ON で、お店の回線から来ているときだけ通す。だめなら現場向けの文で例外。
 */
export async function requireActiveDisplayDevice(): Promise<{ device: DisplayDevice; supabase: Supabase }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.display_device !== true) throw new Error('この端末はディスプレイとして登録されていません');
  const admin = createAdminClient();
  const { data: row } = await admin.from('display_devices').select(DEVICE_COLUMNS).eq('profile_id', user.id).maybeSingle();
  if (!row) throw new Error('この端末は解除されました');
  const device = deviceFrom(row);
  if (device.status !== 'active') throw new Error('この端末は解除されました');
  const approval = await readDeviceApproval(admin, 'display', device.id);
  if (approval === 'pending') throw new Error(DEVICE_MESSAGE.pending);
  if (approval !== 'approved') throw new Error('この端末は解除されました');
  const flag = await loadDisplayMonitorFlag(device.organizationId, device.storeId, admin);
  if (!flag.on) throw new Error('この機能は使えません（運営にお問い合わせください）');
  const ip = await currentRequestIp();
  if (!(await isDisplayOnStoreNetwork(device.storeId, ip, admin))) throw new Error('お店の回線につないでください');
  return { device, supabase };
}

// -------------------------------------------------------------
// 呼び出しモニターの中身
// -------------------------------------------------------------

interface CallItemRow {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  kitchen_status: string;
  kitchen_ready_at: string | null;
  created_at: string;
  orders: { order_no: number; status: string; restaurant_tables: { name: string } | null } | null;
}

/** 品目 → 持ち場（menu_categories.station。未設定は kitchen）。KDS（lib/kds-server.ts）と同じ決め方 */
export async function stationsByMenuItem(supabase: Supabase, menuItemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (menuItemIds.length === 0) return out;
  const { data: menuItemRows } = await supabase.from('menu_items').select('id, category_id').in('id', menuItemIds);
  const categoryIds = [...new Set((menuItemRows ?? []).map((m) => m.category_id as string | null).filter((v): v is string => !!v))];
  let byCategory = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data: categoryRows } = await supabase.from('menu_categories').select('id, station').in('id', categoryIds);
    byCategory = new Map((categoryRows ?? []).map((c) => [c.id as string, (c.station as string | null) ?? 'kitchen']));
  }
  for (const m of menuItemRows ?? []) {
    const cat = m.category_id as string | null;
    out.set(m.id as string, (cat && byCategory.get(cat)) || 'kitchen');
  }
  return out;
}

/**
 * 呼び出しモニター：今開いている注文（会計前）の、厨房に出した品目から「調理中」「できあがり」を作る。
 * KDS と同じ品目（メニューの商品・取消でない・厨房へ送ったもの・提供済は直近1時間だけ）を見る。
 * stations を決めた端末は、その持ち場の品目だけで判定する。
 */
export async function loadCallBoard(supabase: Supabase, storeId: string, stations: DisplayStation[]): Promise<CallBoard> {
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const query = (filterUnsent: boolean) => {
    let q = supabase
      .from('order_items')
      .select('id, order_id, menu_item_id, kitchen_status, kitchen_ready_at, created_at, orders!inner(order_no, status, restaurant_tables(name))')
      .eq('store_id', storeId)
      .eq('status', 'active');
    // レジで貯めている途中（「厨房へオーダー」未押下）の品目は数えない（KDS と同じ）。メニューに無い明細は下で外す
    if (filterUnsent) q = q.not('kitchen_sent_at', 'is', null);
    return q
      .eq('orders.status', 'open')
      .or(`kitchen_status.neq.served,served_at.gt.${sinceIso}`)
      .order('created_at', { ascending: true })
      .limit(2000);
  };
  const first = await query(true);
  const rows =
    first.error && isMissingColumnError(first.error.message, 'kitchen_sent_at') ? (await query(false)).data : first.data;
  let typed = ((rows ?? []) as unknown as CallItemRow[]).filter((r) => r.menu_item_id != null);

  if (stations.length > 0) {
    const byItem = await stationsByMenuItem(supabase, [...new Set(typed.map((r) => r.menu_item_id as string))]);
    const wanted = new Set<string>(stations);
    typed = typed.filter((r) => wanted.has(byItem.get(r.menu_item_id as string) ?? 'kitchen'));
  }

  const byOrder = new Map<string, CallBoardOrderInput>();
  for (const r of typed) {
    let o = byOrder.get(r.order_id);
    if (!o) {
      o = {
        orderId: r.order_id,
        orderNo: Number(r.orders?.order_no ?? 0),
        status: r.orders?.status ?? 'open',
        tableName: r.orders?.restaurant_tables?.name ?? null,
        items: [],
      };
      byOrder.set(r.order_id, o);
    }
    const st = r.kitchen_status as CallKitchenStatus;
    o.items.push({
      kitchenStatus: st === 'preparing' || st === 'ready' || st === 'served' ? st : 'pending',
      createdAt: r.created_at,
      readyAt: r.kitchen_ready_at,
    });
  }
  return buildCallBoard([...byOrder.values()]);
}

// -------------------------------------------------------------
// 設定の画面（Web の /app/settings/displays と iPad の設定 › ディスプレイ端末 で同じ読み込み）
// -------------------------------------------------------------

/**
 * 設定 › ディスプレイ端末 の中身。機能が OFF でも、すでにつないだ端末は一覧に出す（解除できるように）。
 * 表がまだ無い（migration 00103 未適用）ときは notReady で空の一覧（画面は落とさない）。
 */
export async function loadDisplayDevicesPayload(
  supabase: Supabase,
  ctx: { organizationId: string | null; canEdit: boolean },
  store: { id: string; name: string }
): Promise<DisplayDevicesPayload> {
  const flag = ctx.organizationId ? await loadDisplayMonitorFlag(ctx.organizationId, store.id) : ({ on: false, reason: 'company_off' } as const);
  // 承認の列（migration 00104）があれば一緒に読む。無ければ外して読み直す（承認済みとして出す）
  const { rows: data, error } = await selectDevicesWithApproval<Record<string, unknown>>(
    (columns) => supabase.from('display_devices').select(columns).eq('store_id', store.id).order('paired_at', { ascending: false }),
    'id, name, kind, stations, status, paired_at, last_seen_at, paired_ip, last_ip, user_agent'
  );
  const notReady = flag.reason === 'not_ready' || (!!error && isMissingTableError(error, 'display_devices'));
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  return {
    store,
    canEdit: ctx.canEdit,
    flagOn: flag.on && !notReady,
    flagMessage: flag.on && !notReady ? null : DISPLAY_FLAG_MESSAGE[notReady ? 'not_ready' : flag.reason === 'on' ? 'company_off' : flag.reason],
    notReady,
    pairBase: siteUrl ? `${siteUrl}/display-pair#` : null,
    kinds: DISPLAY_KINDS.map((k) => ({ id: k, label: DISPLAY_KIND_LABELS[k] })),
    stations: DISPLAY_STATIONS.map((s) => ({ id: s, label: DISPLAY_STATION_LABELS[s] })),
    devices: (error ? [] : (data ?? [])).map((d) => {
      const kind = isDisplayKind(d.kind) ? d.kind : 'kitchen';
      const stations = normalizeStations(d.stations);
      return {
        id: d.id as string,
        name: d.name as string,
        kind,
        kindLabel: DISPLAY_KIND_LABELS[kind],
        stations,
        stationsLabel: stationsLabel(stations),
        status: d.status === 'revoked' ? 'revoked' : 'active',
        pairedAt: d.paired_at as string,
        lastSeenAt: (d.last_seen_at as string | null) ?? null,
        pairedIp: (d.paired_ip as string | null) ?? null,
        lastIp: (d.last_ip as string | null) ?? null,
        userAgent: (d.user_agent as string | null) ?? null,
        deviceModel: deviceModelFromUserAgent(d.user_agent as string | null),
        approval: d.approval,
      };
    }),
  };
}
