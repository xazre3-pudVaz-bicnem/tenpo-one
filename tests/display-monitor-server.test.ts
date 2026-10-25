import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * ディスプレイ端末のサーバー側（lib/display-monitor-server.ts・lib/display-ops-server.ts・lib/native-modules/display-devices.ts・
 * lib/auth.ts の役割）を、Supabase・Cookie・ヘッダーを差し替えて確かめる。
 * migration 00103 が未適用（表が無い）でも落ちない・機能 OFF・別の回線・解除済み・なりすまし（user_metadata）など。
 */

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
interface Call {
  table: string;
  op: Op;
  filters: Row;
  payload: Row | null;
  /** select に渡した列（コントロールセンターの列が migration 前に無いことを再現するため） */
  columns?: string;
}
interface Res {
  data: unknown;
  error: unknown;
}

const h = vi.hoisted(() => {
  const state = {
    user: null as null | { id: string; email?: string; app_metadata?: Row; user_metadata?: Row },
    userError: null as null | { status?: number; message: string },
    cookies: new Map<string, string>(),
    setCookies: [] as { name: string; value: string; options?: Row }[],
    headers: new Map<string, string>(),
    ip: '203.0.113.10' as string | null,
    qr: { token: null as string | null, networks: [] as { key: string; label: string; addedAt: string }[], wifiOnly: false },
    calls: [] as Call[],
    respond: ((): Res => ({ data: null, error: null })) as (c: Call) => Res,
    authUsers: new Map<string, { id: string; email: string; app_metadata: Row; user_metadata: Row }>(),
    banned: [] as string[],
    seq: 0,
    /** migration 00104（端末の承認の列）が適用済みか。false のときは新しい列を読むと「列が無い」エラー */
    deviceControlReady: false,
    /** 契約（store_access_policies の行）があるか */
    policyExists: false,
  };
  const makeBuilder = (table: string) => {
    const call: Call = { table, op: 'select', filters: {}, payload: null };
    const done = (): Res => {
      state.calls.push(call);
      const newColumn = /approval_status|approved_at|approved_by|approval_requested_at|register_enabled|handy_enabled|display_limit|approval_since|device_token_hash/.exec(call.columns ?? '');
      if (!state.deviceControlReady && newColumn) {
        return { data: null, error: { code: '42703', message: `column ${table}.${newColumn[0]} does not exist` } };
      }
      return state.respond(call);
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: (cols?: unknown) => {
        if (typeof cols === 'string' && !call.columns) call.columns = cols;
        return q;
      },
      neq: self,
      not: self,
      or: self,
      order: self,
      limit: self,
      insert: (p: Row) => ((call.op = 'insert'), (call.payload = p), q),
      update: (p: Row) => ((call.op = 'update'), (call.payload = p), q),
      upsert: (p: Row) => ((call.op = 'upsert'), (call.payload = p), q),
      delete: () => ((call.op = 'delete'), q),
      eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
      gt: (k: string, v: unknown) => ((call.filters[`gt:${k}`] = v), q),
      in: (k: string, v: unknown) => ((call.filters[`in:${k}`] = v), q),
      is: (k: string, v: unknown) => ((call.filters[`is:${k}`] = v), q),
      maybeSingle: async () => done(),
      single: async () => done(),
      then: (resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(done).then(resolve, reject),
    });
    return q;
  };
  const client = {
    from: (t: string) => makeBuilder(t),
    rpc: async () => ({ error: null }),
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.userError }),
      verifyOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      admin: {
        generateLink: async ({ email }: { email: string }) => ({ data: { properties: { hashed_token: `h-${email}` } }, error: null }),
        createUser: async (attrs: { email: string; app_metadata?: Row; user_metadata?: Row }) => {
          const id = `00000000-0000-4000-8000-${String(++state.seq).padStart(12, '0')}`;
          state.authUsers.set(id, { id, email: attrs.email, app_metadata: attrs.app_metadata ?? {}, user_metadata: attrs.user_metadata ?? {} });
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (id: string) => {
          state.authUsers.delete(id);
          return { error: null };
        },
        getUserById: async (id: string) => ({ data: { user: state.authUsers.get(id) ?? null }, error: null }),
        updateUserById: async (id: string, attrs: { ban_duration?: string }) => {
          if (attrs.ban_duration) state.banned.push(id);
          return { data: {}, error: null };
        },
      },
    },
  };
  return { state, client };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (h.state.cookies.has(n) ? { name: n, value: h.state.cookies.get(n) } : undefined),
    getAll: () => [...h.state.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: Row) => {
      h.state.setCookies.push({ name, value, options });
      h.state.cookies.set(name, value);
    },
  }),
  headers: async () => ({ get: (n: string) => h.state.headers.get(n) ?? null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }));
vi.mock('@/lib/handy-device-server', () => ({
  currentRequestIp: async () => h.state.ip,
  loadHandyQr: async () => ({ qr: h.state.qr, settings: {} }),
}));
vi.mock('@/lib/store-access-server', () => ({
  loadStorePolicy: async () => ({ exists: h.state.policyExists, networks: [], networkEnforced: false, registerLimit: 0, handyLimit: 0, note: '' }),
}));
vi.mock('@/lib/kds-server', () => ({
  loadKdsBoard: async () => ({ groups: [], now: Date.now(), unservedCount: 0, avgElapsedMinutes: 0, kdsSettings: { warn1: 10, warn2: 15, warn3: 25, aggregate: false, sound: false } }),
}));
const actions = vi.hoisted(() => ({
  issueDisplayPairing: vi.fn(async () => ({ code: 'b2'.repeat(24), expiresAt: '2026-10-25T03:05:00.000Z' })),
  revokeDisplayDevice: vi.fn(async () => ({})),
  renameDisplayDevice: vi.fn(async () => ({ error: '端末が見つかりません' })),
  updateDisplayDevice: vi.fn(async () => ({})),
}));
vi.mock('@/app/app/settings/displays/actions', () => actions);

import {
  isDisplayMonitorOnForSettings,
  loadDisplayDevicesPayload,
  loadDisplayMonitorFlag,
  requireActiveDisplayDevice,
  resolveDisplayRequest,
} from '@/lib/display-monitor-server';
import { leaveDisplayDevice, loadDisplayScreenForApp, markDisplayOrderServed, pairDisplayDeviceWithCode, suspendDisplayAccount } from '@/lib/display-ops-server';
import { DISPLAY_DEVICE_COOKIE, hashDisplayDeviceToken, hashPairingCode } from '@/lib/display-pairing';
import { networkKey } from '@/lib/handy-network';
import { displayDevicesGet, DISPLAY_DEVICE_POSTS } from '@/lib/native-modules/display-devices';
import { getSessionContext } from '@/lib/auth';
import { resetDeviceControlSchemaCache } from '@/lib/device-control-server';
import type { SessionContext } from '@/lib/auth';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000c1';
const PROFILE = '00000000-0000-4000-8000-0000000000d1';
const ORDER = '00000000-0000-4000-8000-0000000000e1';
const CODE = 'a1'.repeat(24);
const TOKEN = 'c3'.repeat(24);
const MISSING = (table: string) => ({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } });

const deviceRow = (over: Row = {}) => ({
  id: DEVICE,
  organization_id: ORG,
  store_id: STORE,
  name: '受け渡し口',
  kind: 'call',
  stations: [],
  profile_id: PROFILE,
  status: 'active',
  last_seen_at: null,
  ...over,
});

/** 機能 ON（企業・店舗）・店舗・企業が使える状態の返事。over で表ごとに差し替える */
function world(over: Partial<Record<string, (c: Call) => Res>> = {}) {
  h.state.respond = (c: Call) => {
    const f = over[c.table];
    if (f) return f(c);
    if (c.table === 'feature_flags') return { data: { enabled: true }, error: null };
    if (c.table === 'store_feature_flags') return { data: { enabled: true }, error: null };
    if (c.table === 'stores') return { data: { id: STORE, name: 'TENPO ONE 新宿店', status: 'active', organization_id: ORG }, error: null };
    if (c.table === 'organizations') return { data: { id: ORG, status: 'active' }, error: null };
    return { data: null, error: null };
  };
}

const displayUser = () => ({ id: PROFILE, email: 'display-x@devices.tenpo-one.com', app_metadata: { display_device: true }, user_metadata: {} });

beforeEach(() => {
  h.state.user = null;
  h.state.userError = null;
  h.state.cookies = new Map();
  h.state.setCookies = [];
  h.state.headers = new Map([
    ['x-forwarded-for', '203.0.113.10'],
    ['user-agent', 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15'],
  ]);
  h.state.ip = '203.0.113.10';
  h.state.qr = { token: null, networks: [], wifiOnly: false };
  h.state.calls = [];
  h.state.authUsers = new Map();
  h.state.banned = [];
  h.state.deviceControlReady = false;
  h.state.policyExists = false;
  resetDeviceControlSchemaCache();
  world();
});

describe('機能の ON/OFF（企業 × 店舗。読めなくても OFF にするだけ）', () => {
  it('企業の行が無い＝OFF（店舗の表は見ない）', async () => {
    world({ feature_flags: () => ({ data: null, error: null }) });
    expect(await loadDisplayMonitorFlag(ORG, STORE)).toEqual({ on: false, reason: 'company_off' });
    expect(h.state.calls.some((c) => c.table === 'store_feature_flags')).toBe(false);
  });

  it('企業 ON・店舗の表が無い（migration 00103 未適用）＝ not_ready', async () => {
    world({ store_feature_flags: () => MISSING('store_feature_flags') });
    expect(await loadDisplayMonitorFlag(ORG, STORE)).toEqual({ on: false, reason: 'not_ready' });
  });

  it('企業 ON・店舗の行なし＝ store_off、両方 ON ＝ on', async () => {
    world({ store_feature_flags: () => ({ data: null, error: null }) });
    expect(await loadDisplayMonitorFlag(ORG, STORE)).toEqual({ on: false, reason: 'store_off' });
    world();
    expect(await loadDisplayMonitorFlag(ORG, STORE)).toEqual({ on: true, reason: 'on' });
    expect(await isDisplayMonitorOnForSettings({ organizationId: ORG, currentStore: { id: STORE }, stores: [] })).toBe(true);
    expect(await isDisplayMonitorOnForSettings({ organizationId: null, currentStore: { id: STORE }, stores: [] })).toBe(false);
  });

  it('読み込みで例外が出ても画面は落とさない（OFF）', async () => {
    h.state.respond = () => {
      throw new Error('network down');
    };
    expect(await loadDisplayMonitorFlag(ORG, STORE)).toEqual({ on: false, reason: 'company_off' });
  });
});

describe('設定 › ディスプレイ端末 の中身（Web と iPad で同じ）', () => {
  it('表が無い（migration 未適用）：notReady・空の一覧・QR を出さない', async () => {
    world({ store_feature_flags: () => MISSING('store_feature_flags'), display_devices: () => MISSING('display_devices') });
    const p = await loadDisplayDevicesPayload(h.client as never, { organizationId: ORG, canEdit: true }, { id: STORE, name: 'TENPO ONE 新宿店' });
    expect(p.notReady).toBe(true);
    expect(p.flagOn).toBe(false);
    expect(p.devices).toEqual([]);
    expect(p.flagMessage).toBe('この機能は使えません（運営にお問い合わせください）');
    expect(p.kinds.map((k) => k.id)).toEqual(['kitchen', 'call']);
  });

  it('端末の行を一覧の形にする（種類・持ち場・機種）', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://tenpo-one.example/';
    world({
      display_devices: () => ({
        data: [{ ...deviceRow({ kind: 'kitchen', stations: ['drink', 'zzz'] }), paired_at: '2026-10-25T01:00:00Z', paired_ip: '203.0.113.10', last_ip: null, user_agent: 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K)' }],
        error: null,
      }),
    });
    const p = await loadDisplayDevicesPayload(h.client as never, { organizationId: ORG, canEdit: true }, { id: STORE, name: 'TENPO ONE 新宿店' });
    expect(p.flagOn).toBe(true);
    expect(p.pairBase).toBe('https://tenpo-one.example/display-pair#');
    expect(p.devices[0]).toMatchObject({ kind: 'kitchen', kindLabel: 'キッチンディスプレイ', stations: ['drink'], stationsLabel: 'ドリンク', deviceModel: 'Android TV 11', status: 'active' });
  });
});

describe('/display を開いた端末の判定', () => {
  it('未ログイン・鍵なし＝未登録。スタッフのアカウント＝未登録（スタッフで開いている）', async () => {
    expect(await resolveDisplayRequest()).toEqual({ kind: 'unpaired', staffSignedIn: false });
    h.state.user = { id: 'staff', app_metadata: {}, user_metadata: {} };
    expect(await resolveDisplayRequest()).toEqual({ kind: 'unpaired', staffSignedIn: true });
  });

  it('user_metadata に display_device を書いただけ（本人が書ける）ではディスプレイ扱いにしない', async () => {
    h.state.user = { id: PROFILE, app_metadata: {}, user_metadata: { display_device: true } };
    world({ display_devices: () => ({ data: deviceRow(), error: null }) });
    expect((await resolveDisplayRequest()).kind).toBe('unpaired');
  });

  it('つないだ端末：ready（お店の回線・機能 ON）。「使用中」を記録する', async () => {
    h.state.user = displayUser();
    world({ display_devices: (c) => (c.op === 'select' ? { data: deviceRow(), error: null } : { data: null, error: null }) });
    const s = await resolveDisplayRequest();
    expect(s.kind).toBe('ready');
    if (s.kind === 'ready') {
      expect(s.onNetwork).toBe(true);
      expect(s.flag.on).toBe(true);
      expect(s.storeName).toBe('TENPO ONE 新宿店');
    }
    const touch = h.state.calls.find((c) => c.table === 'display_devices' && c.op === 'update');
    expect(touch?.payload).toMatchObject({ last_ip: '203.0.113.10' });
  });

  it('お店の Wi-Fi だけの店で、ほかの回線から＝ onNetwork false（ログアウト・解除はしない）', async () => {
    h.state.user = displayUser();
    h.state.qr = { token: null, wifiOnly: true, networks: [{ key: networkKey('198.51.100.1'), label: 'お店', addedAt: '2026-10-01T00:00:00Z' }] };
    world({ display_devices: (c) => (c.op === 'select' ? { data: deviceRow(), error: null } : { data: null, error: null }) });
    const s = await resolveDisplayRequest();
    expect(s.kind === 'ready' && s.onNetwork).toBe(false);
    expect(h.state.calls.some((c) => c.table === 'display_devices' && c.payload && 'status' in c.payload)).toBe(false);
  });

  it('解除済み・表が無い・セッション切れ（鍵あり）・通信が不安定', async () => {
    h.state.user = displayUser();
    world({ display_devices: () => ({ data: deviceRow({ status: 'revoked' }), error: null }) });
    expect(await resolveDisplayRequest()).toEqual({ kind: 'revoked', name: '受け渡し口' });

    world({ display_devices: () => MISSING('display_devices') });
    expect(await resolveDisplayRequest()).toEqual({ kind: 'not_ready' });

    h.state.user = null;
    h.state.cookies.set(DISPLAY_DEVICE_COOKIE, TOKEN);
    world({ display_devices: (c) => (c.filters.device_token_hash === hashDisplayDeviceToken(TOKEN) ? { data: deviceRow(), error: null } : { data: null, error: null }) });
    expect(await resolveDisplayRequest()).toEqual({ kind: 'resume' });

    h.state.cookies = new Map([['sb-x-auth-token', 'v']]);
    h.state.userError = { status: 500, message: 'upstream' };
    expect(await resolveDisplayRequest()).toEqual({ kind: 'transient' });
  });
});

describe('ディスプレイの操作の入口（requireActiveDisplayDevice）', () => {
  it('スタッフ・解除済み・機能 OFF・回線の外は断る', async () => {
    h.state.user = { id: 'staff', app_metadata: {}, user_metadata: {} };
    await expect(requireActiveDisplayDevice()).rejects.toThrow('ディスプレイとして登録されていません');

    h.state.user = displayUser();
    world({ display_devices: () => ({ data: deviceRow({ status: 'revoked' }), error: null }) });
    await expect(requireActiveDisplayDevice()).rejects.toThrow('解除されました');

    world({ display_devices: () => ({ data: deviceRow(), error: null }), store_feature_flags: () => ({ data: { enabled: false }, error: null }) });
    await expect(requireActiveDisplayDevice()).rejects.toThrow('この機能は使えません');

    world({ display_devices: () => ({ data: deviceRow(), error: null }) });
    h.state.qr = { token: null, wifiOnly: true, networks: [{ key: networkKey('198.51.100.1'), label: 'お店', addedAt: '2026-10-01T00:00:00Z' }] };
    await expect(requireActiveDisplayDevice()).rejects.toThrow('お店の回線');
  });

  it('持ち場を決めたキッチンの端末は、ほかの持ち場の品目を提供済にしない', async () => {
    h.state.user = displayUser();
    world({
      display_devices: () => ({ data: deviceRow({ kind: 'kitchen', stations: ['drink'] }), error: null }),
      orders: () => ({ data: { id: ORDER, store_id: STORE }, error: null }),
      order_items: (c) =>
        c.op === 'select'
          ? {
              data: [
                { id: 'i-drink', menu_item_id: 'm-drink', kitchen_status: 'pending', kitchen_started_at: null, kitchen_ready_at: null },
                { id: 'i-food', menu_item_id: 'm-food', kitchen_status: 'pending', kitchen_started_at: null, kitchen_ready_at: null },
              ],
              error: null,
            }
          : { data: null, error: null },
      menu_items: () => ({ data: [{ id: 'm-drink', category_id: 'c-drink' }, { id: 'm-food', category_id: 'c-food' }], error: null }),
      menu_categories: () => ({ data: [{ id: 'c-drink', station: 'drink' }, { id: 'c-food', station: 'kitchen' }], error: null }),
    });
    await markDisplayOrderServed(ORDER);
    const updated = h.state.calls.filter((c) => c.table === 'order_items' && c.op === 'update').map((c) => c.filters.id);
    expect(updated).toEqual(['i-drink']);
  });

  it('呼び出しモニターの端末はキッチンの操作をできない', async () => {
    h.state.user = displayUser();
    world({ display_devices: () => ({ data: deviceRow({ kind: 'call' }), error: null }) });
    await expect(markDisplayOrderServed(ORDER)).rejects.toThrow('この端末では操作できません');
  });
});

describe('ペアリング（QR を読んだ端末を登録）', () => {
  const pairingRow = (over: Row = {}) => ({
    id: 'pair-1',
    organization_id: ORG,
    store_id: STORE,
    issued_ip: '203.0.113.10',
    device_name: '受け渡し口',
    kind: 'call',
    stations: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_at: null,
    created_by: 'manager',
    ...over,
  });

  it('形式が違う・表が無い・別の回線・機能 OFF は登録しない', async () => {
    expect((await pairDisplayDeviceWithCode('nope')).error).toContain('このQRコードは使えません');

    world({ display_pairings: () => MISSING('display_pairings') });
    expect((await pairDisplayDeviceWithCode(CODE)).error).toBe('この機能は使えません（運営にお問い合わせください）');

    world({ display_pairings: () => ({ data: pairingRow(), error: null }) });
    h.state.headers.set('x-forwarded-for', '198.51.100.7');
    expect((await pairDisplayDeviceWithCode(CODE)).error).toContain('お店の回線');

    h.state.headers.set('x-forwarded-for', '203.0.113.10');
    world({ display_pairings: () => ({ data: pairingRow(), error: null }), store_feature_flags: () => ({ data: null, error: null }) });
    expect((await pairDisplayDeviceWithCode(CODE)).error).toBe('この機能は使えません（運営にお問い合わせください）');
    expect(h.state.authUsers.size).toBe(0);
  });

  it('成立：端末の専用アカウント（app_metadata.display_device・アルバイト）を作り、QR を使用済みにして、端末の鍵を Cookie に入れる', async () => {
    const inserts: Call[] = [];
    world({
      display_pairings: (c) => {
        if (c.op === 'select') {
          expect(c.filters.code_hash).toBe(hashPairingCode(CODE));
          return { data: pairingRow(), error: null };
        }
        expect(c.filters['is:used_at']).toBeNull();
        return { data: [{ id: 'pair-1' }], error: null };
      },
      memberships: (c) => (inserts.push(c), { data: { id: 'mem-1' }, error: null }),
      membership_stores: (c) => (inserts.push(c), { data: null, error: null }),
      display_devices: (c) => (inserts.push(c), { data: { id: DEVICE }, error: null }),
    });
    const r = await pairDisplayDeviceWithCode(CODE);
    expect(r).toEqual({ storeName: 'TENPO ONE 新宿店', kindLabel: '呼び出しモニター' });
    const [user] = [...h.state.authUsers.values()];
    expect(user.app_metadata).toEqual({ display_device: true });
    expect(user.user_metadata).not.toHaveProperty('display_device');
    expect(inserts.find((c) => c.table === 'memberships')?.payload).toMatchObject({ role: 'part_time', organization_id: ORG });
    const deviceInsert = inserts.find((c) => c.table === 'display_devices')?.payload;
    const cookie = h.state.setCookies.find((c) => c.name === DISPLAY_DEVICE_COOKIE);
    expect(cookie?.value).toMatch(/^[0-9a-f]{48}$/);
    expect(cookie?.options).toMatchObject({ httpOnly: true, path: '/' });
    expect(deviceInsert?.device_token_hash).toBe(hashDisplayDeviceToken(cookie!.value));
  });

  it('ほぼ同時に別の端末が使った：作りかけの端末とアカウントを消して USED', async () => {
    world({
      display_pairings: (c) => (c.op === 'select' ? { data: pairingRow(), error: null } : { data: [], error: null }),
      memberships: () => ({ data: { id: 'mem-1' }, error: null }),
      display_devices: () => ({ data: { id: DEVICE }, error: null }),
    });
    expect((await pairDisplayDeviceWithCode(CODE)).error).toContain('使用済み');
    expect(h.state.authUsers.size).toBe(0);
    expect(h.state.calls.some((c) => c.table === 'display_devices' && c.op === 'delete')).toBe(true);
    expect(h.state.setCookies).toEqual([]);
  });
});

describe('この iPad をレジに戻す（自分で解除）', () => {
  it('つないだ端末：解除・アカウント停止・ログアウト・鍵を消す', async () => {
    h.state.user = displayUser();
    h.state.authUsers.set(PROFILE, { id: PROFILE, email: 'd@devices.tenpo-one.com', app_metadata: { display_device: true }, user_metadata: {} });
    world({ display_devices: (c) => (c.op === 'select' ? { data: deviceRow(), error: null } : { data: null, error: null }) });
    expect(await leaveDisplayDevice()).toEqual({ ok: true });
    expect(h.state.calls.find((c) => c.table === 'display_devices' && c.op === 'update')?.payload).toMatchObject({ status: 'revoked', device_token_hash: null });
    expect(h.state.calls.find((c) => c.table === 'memberships' && c.op === 'update')?.payload).toEqual({ status: 'suspended' });
    expect(h.state.banned).toEqual([PROFILE]);
    expect(h.state.setCookies.find((c) => c.name === DISPLAY_DEVICE_COOKIE)?.options).toMatchObject({ maxAge: 0 });
  });

  it('ディスプレイ端末でないアカウントは止めない', async () => {
    h.state.authUsers.set('staff', { id: 'staff', email: 's@example.com', app_metadata: {}, user_metadata: { display_device: true } });
    await suspendDisplayAccount(h.client as never, 'staff');
    expect(h.state.banned).toEqual([]);
    expect(h.state.calls.some((c) => c.table === 'memberships')).toBe(false);
  });
});

describe('iPad アプリのネイティブのディスプレイ（GET /api/app/v1/display）', () => {
  it('呼び出しモニター：画面と中身・次の読み直し', async () => {
    h.state.user = displayUser();
    world({
      display_devices: (c) => (c.op === 'select' ? { data: deviceRow(), error: null } : { data: null, error: null }),
      order_items: () => ({
        data: [
          { id: 'x1', order_id: ORDER, menu_item_id: 'm1', kitchen_status: 'ready', kitchen_ready_at: '2026-10-25T03:00:00Z', created_at: '2026-10-25T02:50:00Z', orders: { order_no: 105, status: 'open', restaurant_tables: null } },
        ],
        error: null,
      }),
    });
    const p = await loadDisplayScreenForApp();
    expect(p.screen).toBe('board');
    expect(p.device).toMatchObject({ kind: 'call', kindLabel: '呼び出しモニター', stationsLabel: 'すべて' });
    expect(p.call?.ready.map((e) => e.orderNo)).toEqual([105]);
    expect(p.refreshSec).toBe(5);
    expect(p.heartbeat).toBe(true);
  });

  it('migration 未適用・未登録は案内（例外にしない）', async () => {
    h.state.user = displayUser();
    world({ display_devices: () => MISSING('display_devices') });
    const p = await loadDisplayScreenForApp();
    expect(p).toMatchObject({ screen: 'notice', notice: { icon: 'off' }, heartbeat: false });
    h.state.user = null;
    expect((await loadDisplayScreenForApp()).notice?.icon).toBe('unpaired');
  });
});

describe('設定 › ディスプレイ端末 の iPad の API（lib/native-modules/display-devices.ts）', () => {
  const ctx = (role: string) => ({ role, organizationId: ORG, stores: [], isHq: true }) as unknown as SessionContext;
  const store = { id: STORE, name: 'TENPO ONE 新宿店' };

  it('店長以上だけ（store.settings）', async () => {
    const r = await displayDevicesGet({ ctx: ctx('staff'), store, url: new URL('https://x/api') });
    expect(r.status).toBe(403);
    const ok = await displayDevicesGet({ ctx: ctx('store_manager'), store, url: new URL('https://x/api') });
    expect(ok.body).toMatchObject({ ok: true, store, canEdit: true });
    const post = await DISPLAY_DEVICE_POSTS.displayRevoke({ ctx: ctx('staff'), store, raw: { type: 'displayRevoke', id: DEVICE } });
    expect(post.status).toBe(403);
  });

  it('QR の発行は返事に code を載せる・中身が違えば 400・エラーはそのまま', async () => {
    const issued = await DISPLAY_DEVICE_POSTS.displayIssue({ ctx: ctx('org_owner'), store, raw: { type: 'displayIssue', deviceName: '厨房', kind: 'kitchen', stations: ['drink'] } });
    expect(issued.body).toEqual({ ok: true, code: 'b2'.repeat(24), expiresAt: '2026-10-25T03:05:00.000Z' });
    expect(actions.issueDisplayPairing).toHaveBeenCalledWith(STORE, { deviceName: '厨房', kind: 'kitchen', stations: ['drink'] });
    const bad = await DISPLAY_DEVICE_POSTS.displayUpdate({ ctx: ctx('org_owner'), store, raw: { type: 'displayUpdate', id: 'x', kind: 'call' } });
    expect(bad.status).toBe(400);
    const err = await DISPLAY_DEVICE_POSTS.displayRename({ ctx: ctx('org_owner'), store, raw: { type: 'displayRename', id: DEVICE, name: '入口' } });
    expect(err.body).toEqual({ ok: false, error: '端末が見つかりません' });
  });
});

describe('lib/auth.ts：ディスプレイ端末のアカウントは役割なし', () => {
  const sessionWorld = () =>
    world({
      profiles: () => ({ data: { id: PROFILE, display_name: '受け渡し口（ディスプレイ）', is_cypress_admin: false, status: 'active' }, error: null }),
      memberships: () => ({ data: { id: 'mem-1', organization_id: ORG, role: 'part_time', organizations: { id: ORG, name: 'テスト企業', status: 'active' } }, error: null }),
      membership_stores: () => ({ data: [{ stores: { id: STORE, name: 'TENPO ONE 新宿店', slug: 'shinjuku' } }], error: null }),
      feature_flags: () => ({ data: [], error: null }),
    });

  it('app_metadata.display_device の端末：role null・isDisplayDevice（requirePermission・can() は全部断る）', async () => {
    sessionWorld();
    h.state.user = displayUser();
    const ctx = await getSessionContext();
    expect(ctx?.role).toBeNull();
    expect(ctx?.isDisplayDevice).toBe(true);
    expect(ctx?.organizationId).toBe(ORG);
    expect(ctx?.stores.map((s) => s.id)).toEqual([STORE]);
  });

  it('user_metadata に書いただけのアカウントは今まで通り（役割そのまま）', async () => {
    sessionWorld();
    h.state.user = { id: PROFILE, app_metadata: {}, user_metadata: { display_device: true } };
    const ctx = await getSessionContext();
    expect(ctx?.role).toBe('part_time');
    expect(ctx?.isDisplayDevice).toBe(false);
  });
});

describe('コントロールセンター（migration 00104 の後）：運営が承認するまで画面を出さない', () => {
  const pairingRow = () => ({
    id: 'pair-1',
    organization_id: ORG,
    store_id: STORE,
    issued_ip: '203.0.113.10',
    device_name: '受け渡し口',
    kind: 'call',
    stations: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_at: null,
    created_by: 'manager',
  });

  it('承認制 OFF（既定）：migration の後も今まで通り、つないだ端末はすぐ使える（承認の列は書かない）', async () => {
    h.state.deviceControlReady = true;
    const inserts: Call[] = [];
    world({
      display_pairings: (c) => (c.op === 'select' ? { data: pairingRow(), error: null } : { data: [{ id: 'pair-1' }], error: null }),
      memberships: (c) => (inserts.push(c), { data: { id: 'mem-1' }, error: null }),
      membership_stores: () => ({ data: null, error: null }),
      display_devices: (c) => (c.op === 'insert' ? (inserts.push(c), { data: { id: DEVICE }, error: null }) : { data: null, error: null }),
    });
    expect(await pairDisplayDeviceWithCode(CODE)).toEqual({ storeName: 'TENPO ONE 新宿店', kindLabel: '呼び出しモニター' });
    expect(inserts.find((c) => c.table === 'memberships')?.payload).toMatchObject({ status: 'active' });
    expect(inserts.find((c) => c.table === 'display_devices')?.payload).not.toHaveProperty('approval_status');
  });

  it('承認制 ON：QR でつないだ端末は承認待ちで作る（所属は止めておく・ログインと鍵は渡す＝承認されると自動で画面が出る）', async () => {
    h.state.deviceControlReady = true;
    h.state.policyExists = true;
    const inserts: Call[] = [];
    world({
      display_pairings: (c) => (c.op === 'select' ? { data: pairingRow(), error: null } : { data: [{ id: 'pair-1' }], error: null }),
      store_access_policies: () => ({ data: { register_enabled: true, handy_enabled: true, display_limit: null, display_approval_since: '2026-01-01T00:00:00Z' }, error: null }),
      memberships: (c) => (inserts.push(c), { data: { id: 'mem-1' }, error: null }),
      membership_stores: () => ({ data: null, error: null }),
      display_devices: (c) => (c.op === 'insert' ? (inserts.push(c), { data: { id: DEVICE }, error: null }) : { data: null, error: null }),
    });
    const r = await pairDisplayDeviceWithCode(CODE);
    expect(r).toEqual({ storeName: 'TENPO ONE 新宿店', kindLabel: '呼び出しモニター', pending: true });
    expect(inserts.find((c) => c.table === 'memberships')?.payload).toMatchObject({ status: 'suspended' });
    expect(inserts.find((c) => c.table === 'display_devices')?.payload).toMatchObject({ approval_status: 'pending' });
    expect(h.state.setCookies.some((c) => c.name === DISPLAY_DEVICE_COOKIE)).toBe(true);
  });

  it('運営が決めた台数に達していたら作らない（台数が未設定＝数えない）', async () => {
    h.state.deviceControlReady = true;
    h.state.policyExists = true;
    world({
      display_pairings: () => ({ data: pairingRow(), error: null }),
      store_access_policies: () => ({ data: { register_enabled: true, handy_enabled: true, display_limit: 1 }, error: null }),
      display_devices: (c) => (c.filters.approval_status === 'approved' ? { data: null, error: null, count: 1 } as Res : { data: null, error: null }),
    });
    const r = await pairDisplayDeviceWithCode(CODE);
    expect(r.error).toContain('ディスプレイ端末の台数の上限');
    expect(h.state.authUsers.size).toBe(0);
  });

  it('承認待ちの端末の /display：案内（pending）。操作は断る', async () => {
    h.state.deviceControlReady = true;
    h.state.user = displayUser();
    world({
      display_devices: (c) =>
        c.op !== 'select'
          ? { data: null, error: null }
          : c.columns === 'approval_status'
            ? { data: { approval_status: 'pending' }, error: null }
            : { data: deviceRow(), error: null },
    });
    const s = await resolveDisplayRequest();
    expect(s).toEqual({ kind: 'pending', name: '受け渡し口', storeName: 'TENPO ONE 新宿店' });
    await expect(requireActiveDisplayDevice()).rejects.toThrow('承認待ち');
  });

  it('承認済み（既存の端末）はそのまま', async () => {
    h.state.deviceControlReady = true;
    h.state.user = displayUser();
    world({
      display_devices: (c) =>
        c.op !== 'select'
          ? { data: null, error: null }
          : c.columns === 'approval_status'
            ? { data: { approval_status: 'approved' }, error: null }
            : { data: deviceRow(), error: null },
    });
    expect((await resolveDisplayRequest()).kind).toBe('ready');
  });
});
