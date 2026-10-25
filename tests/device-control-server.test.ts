import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * コントロールセンター（2026-10-25）のサーバー側を、Supabase・Cookie を差し替えて確かめる。
 *   - migration 00104 の列が無い間は今まで通り（lib/schema-compat.ts と同じ「列が無い」の見分け方）
 *   - レジ（iPad）：ログイン・レジの画面での端末の判定（承認待ち・契約 OFF・台数）
 *   - ハンディ：QR を読んだ端末（承認待ちで作る・承認済みは使い直す・端末の鍵）
 *   - テーブルQR の ON/OFF の読み込み
 */

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
interface Call {
  table: string;
  op: Op;
  filters: Row;
  payload: Row | null;
  columns?: string;
  head?: boolean;
}
interface Res {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

const h = vi.hoisted(() => {
  const state = {
    ready: false,
    cookies: new Map<string, string>(),
    setCookies: [] as { name: string; value: string; options?: Row }[],
    headers: new Map<string, string>(),
    user: null as null | { id: string; user_metadata?: Row; app_metadata?: Row },
    calls: [] as Call[],
    respond: ((): Res => ({ data: null, error: null })) as (c: Call) => Res,
    signedIn: [] as string[],
    signedOut: [] as string[],
    seq: 0,
    rpc: [] as Row[],
    throwOn: null as string | null,
  };
  const NEW_COLUMNS = /approval_status|register_enabled|handy_enabled|display_limit|device_token_hash/;
  const makeBuilder = (table: string) => {
    const call: Call = { table, op: 'select', filters: {}, payload: null };
    const done = (): Res => {
      state.calls.push(call);
      if (state.throwOn === table) throw new Error('network down');
      const m = NEW_COLUMNS.exec(call.columns ?? '') ?? NEW_COLUMNS.exec(JSON.stringify(call.payload ?? {}));
      if (!state.ready && m) return { data: null, error: { code: '42703', message: `column ${table}.${m[0]} does not exist` } };
      return state.respond(call);
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: (cols?: unknown, opts?: { head?: boolean }) => {
        if (typeof cols === 'string' && call.op === 'select') call.columns = cols;
        if (opts?.head) call.head = true;
        return q;
      },
      order: self,
      limit: self,
      or: self,
      insert: (p: Row) => ((call.op = 'insert'), (call.payload = p), q),
      update: (p: Row) => ((call.op = 'update'), (call.payload = p), q),
      upsert: (p: Row) => ((call.op = 'upsert'), (call.payload = p), q),
      delete: () => ((call.op = 'delete'), q),
      eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
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
    rpc: async (_fn: string, args: Row) => {
      state.rpc.push(args);
      return { error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      verifyOtp: async ({ token_hash }: { token_hash: string }) => {
        state.signedIn.push(token_hash);
        return { error: null };
      },
      admin: {
        generateLink: async ({ email }: { email: string }) => ({ data: { properties: { hashed_token: `h-${email}` } }, error: null }),
        createUser: async (attrs: { email: string }) => {
          const id = `00000000-0000-4000-8000-${String(++state.seq).padStart(12, '0')}`;
          void attrs;
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async () => ({ error: null }),
        getUserById: async (id: string) => ({ data: { user: { id, email: `handy-${id}@devices.tenpo-one.com` } }, error: null }),
        signOut: async (id: string) => {
          state.signedOut.push(id);
          return { error: null };
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
    delete: (name: string) => h.state.cookies.delete(name),
  }),
  headers: async () => ({ get: (n: string) => h.state.headers.get(n) ?? null }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }));

import {
  countStoreDevices,
  deviceControlReady,
  hashHandyDeviceToken,
  isMissingDeviceControlSchema,
  loadContractColumns,
  readDeviceApproval,
  resetDeviceControlSchemaCache,
  selectDevicesWithApproval,
} from '@/lib/device-control-server';
import { checkRegisterDevice, gateRegisterLogin, hashDeviceToken, peekRegisterDevice } from '@/lib/store-access-server';
import { ensureHandyDeviceToken, gateHandyJoin, handyContractOff } from '@/lib/handy-device-approval-server';
import { loadQrOrderFlag } from '@/lib/qr-order-flag-server';
import { policyFrom, REGISTER_COOKIE, type StoreAccessPolicy } from '@/lib/store-access';
import { DEVICE_MESSAGE, HANDY_DEVICE_COOKIE } from '@/lib/device-control';
import { createClient } from '@/lib/supabase/server';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'ab'.repeat(24);
const admin = h.client as unknown as Parameters<typeof loadContractColumns>[0];

/** 契約の行（store_access_policies）がある店舗。台数2 */
const CONTRACT: StoreAccessPolicy = policyFrom({ register_limit: 2, handy_limit: 2 });
const NO_CONTRACT: StoreAccessPolicy = policyFrom(null);

/** 表ごとの返事。count は head の数え上げ */
function world(tables: Partial<Record<string, (c: Call) => Res>> = {}) {
  h.state.respond = (c: Call) => {
    const f = tables[c.table];
    if (f) return f(c);
    if (c.head) return { data: null, error: null, count: 0 };
    return { data: null, error: null };
  };
}

const inserts = (table: string) => h.state.calls.filter((c) => c.table === table && c.op === 'insert');
const updates = (table: string) => h.state.calls.filter((c) => c.table === table && c.op === 'update');

beforeEach(() => {
  resetDeviceControlSchemaCache();
  h.state.ready = false;
  h.state.cookies = new Map();
  h.state.setCookies = [];
  h.state.headers = new Map([
    ['x-forwarded-for', '203.0.113.10'],
    ['user-agent', 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X)'],
  ]);
  h.state.user = null;
  h.state.calls = [];
  h.state.signedIn = [];
  h.state.signedOut = [];
  h.state.rpc = [];
  h.state.throwOn = null;
  world();
});

describe('migration 00104 が適用済みか（lib/schema-compat.ts と同じ見分け方）', () => {
  it('列が無い＝未適用（1 分は覚えておき、読み直さない）', async () => {
    expect(await deviceControlReady(admin)).toBe(false);
    const probes = h.state.calls.length;
    expect(probes).toBe(4);
    expect(await deviceControlReady(admin)).toBe(false);
    expect(h.state.calls.length).toBe(probes);
  });

  it('列がある＝適用済み（以後は確かめない）', async () => {
    h.state.ready = true;
    expect(await deviceControlReady(admin)).toBe(true);
    const probes = h.state.calls.length;
    expect(await deviceControlReady(admin)).toBe(true);
    expect(h.state.calls.length).toBe(probes);
  });

  it('列が無いのとは別のエラー（通信など）は覚えずに false（次の呼び出しで確かめ直す）', async () => {
    h.state.ready = true;
    world({ register_devices: () => ({ data: null, error: { code: '08006', message: 'connection reset' } }) });
    expect(await deviceControlReady(admin)).toBe(false);
    world();
    expect(await deviceControlReady(admin)).toBe(true);
  });

  it('列・表が無いエラーの見分け方', () => {
    expect(isMissingDeviceControlSchema({ code: '42703', message: 'column register_devices.approval_status does not exist' })).toBe(true);
    expect(isMissingDeviceControlSchema({ message: "Could not find the 'register_enabled' column of 'store_access_policies' in the schema cache" })).toBe(true);
    expect(isMissingDeviceControlSchema({ code: 'PGRST205', message: "Could not find the table 'public.display_devices' in the schema cache" })).toBe(true);
    expect(isMissingDeviceControlSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingDeviceControlSchema(null)).toBe(false);
  });

  it('契約の列：未適用・行が無い・読めないときは ON・既定の台数', async () => {
    expect(await loadContractColumns(admin, STORE, false)).toEqual({ registerEnabled: true, handyEnabled: true, displayLimit: 2 });
    expect(h.state.calls.length).toBe(0);
    expect(await loadContractColumns(admin, STORE, true)).toEqual({ registerEnabled: true, handyEnabled: true, displayLimit: 2 });
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: { register_enabled: false, handy_enabled: true, display_limit: 3 }, error: null }) });
    expect(await loadContractColumns(admin, STORE, true)).toEqual({ registerEnabled: false, handyEnabled: true, displayLimit: 3 });
  });

  it('台数：未適用は使用中の台数だけ。適用後は承認済みと承認待ちを分けて数える', async () => {
    world({ handy_devices: (c) => ({ count: c.filters.approval_status === 'pending' ? 1 : 3, data: null, error: null }) });
    expect(await countStoreDevices(admin, 'handy', STORE, false)).toEqual({ approvedActive: 3, pending: 0 });
    const legacy = h.state.calls.at(-1)!;
    expect(legacy.filters).toEqual({ store_id: STORE, status: 'active' });
    h.state.ready = true;
    expect(await countStoreDevices(admin, 'handy', STORE, true)).toEqual({ approvedActive: 3, pending: 1 });
  });

  it('一覧：承認の列が無ければ外して読み直し、承認済みとして返す', async () => {
    world({ handy_devices: () => ({ data: [{ id: DEVICE, name: 'ホール1' }], error: null }) });
    const run = (columns: string) =>
      (h.client.from('handy_devices') as unknown as { select: (c: string) => PromiseLike<{ data: unknown; error: null }> }).select(columns);
    const legacy = await selectDevicesWithApproval(run, 'id, name');
    expect(legacy.ready).toBe(false);
    expect(legacy.rows).toEqual([{ id: DEVICE, name: 'ホール1', approval: 'approved' }]);
    h.state.ready = true;
    world({ handy_devices: () => ({ data: [{ id: DEVICE, name: 'ホール1', approval_status: 'pending' }], error: null }) });
    const ready = await selectDevicesWithApproval(run, 'id, name');
    expect(ready.ready).toBe(true);
    expect(ready.rows[0].approval).toBe('pending');
  });

  it('1台の承認：未適用・読めないときは承認済み（止めない）', async () => {
    expect(await readDeviceApproval(admin, 'display', DEVICE)).toBe('approved');
    resetDeviceControlSchemaCache();
    h.state.ready = true;
    world({ display_devices: (c) => (c.columns === 'approval_status' && c.filters.id ? { data: { approval_status: 'pending' }, error: null } : { data: null, error: null }) });
    expect(await readDeviceApproval(admin, 'display', DEVICE)).toBe('pending');
  });
});

describe('レジ（iPad）：端末の判定', () => {
  it('migration の前：今まで通り（知らない端末は空きがあれば承認なしで登録・ログインでは端末を見ない）', async () => {
    world({ store_access_policies: () => ({ data: { register_limit: 2 }, error: null }) });
    const peek = await peekRegisterDevice(STORE, CONTRACT);
    expect(peek).toEqual({ decision: { kind: 'register' }, limit: 2, approval: false });
    const r = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', createdBy: null, policy: CONTRACT });
    expect(r.decision).toEqual({ kind: 'allowed' });
    expect(r.newToken).toMatch(/^[0-9a-f]{48}$/);
    const [ins] = inserts('register_devices');
    expect(ins.payload).not.toHaveProperty('approval_status');
    h.state.calls = [];
    expect(await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', policy: CONTRACT })).toEqual({});
    expect(inserts('register_devices')).toHaveLength(0);
  });

  it('契約の行が無い店舗：台数も承認も見ない（migration の後も今まで通り）', async () => {
    h.state.ready = true;
    expect(await peekRegisterDevice(STORE, NO_CONTRACT)).toEqual({ decision: { kind: 'allowed' }, limit: 2, approval: false });
    expect(await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', policy: NO_CONTRACT })).toEqual({});
    expect(inserts('register_devices')).toHaveLength(0);
  });

  it('migration の後・新しい iPad のログイン：承認待ちで登録し、Cookie に目印を入れて、ログインさせない', async () => {
    h.state.ready = true;
    const r = await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', policy: CONTRACT });
    expect(r.error).toBe(DEVICE_MESSAGE.pendingRegister);
    const [ins] = inserts('register_devices');
    expect(ins.payload).toMatchObject({ store_id: STORE, approval_status: 'pending', organization_id: ORG });
    const cookie = h.state.setCookies.find((c) => c.name === REGISTER_COOKIE);
    expect(cookie?.options).toMatchObject({ httpOnly: true, secure: true });
    expect(ins.payload?.token_hash).toBe(hashDeviceToken(cookie!.value));
    // 監査ログ（承認待ちの登録）
    expect(h.state.rpc.some((a) => a.p_action === 'device.register_request')).toBe(true);
  });

  it('migration の後・承認待ち／承認済み／運営が解除 の iPad', async () => {
    h.state.ready = true;
    h.state.cookies.set(REGISTER_COOKIE, TOKEN);
    let approval = 'pending';
    let status = 'active';
    world({
      register_devices: (c) =>
        c.head
          ? { count: c.filters.approval_status === 'approved' ? 1 : 0, data: null, error: null }
          : c.filters.token_hash
            ? { data: { id: DEVICE, store_id: STORE, status, approval_status: approval }, error: null }
            : { data: null, error: null },
    });
    expect((await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.pendingRegister);
    expect(inserts('register_devices')).toHaveLength(0);
    expect((await peekRegisterDevice(STORE, CONTRACT)).decision).toEqual({ kind: 'pending' });

    approval = 'approved';
    expect(await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: CONTRACT })).toEqual({});
    expect(updates('register_devices').at(-1)?.payload).toHaveProperty('last_seen_at');

    approval = 'revoked';
    status = 'revoked';
    expect((await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.revoked);
  });

  it('migration の後・レジの契約 OFF：承認済みの iPad でもログイン・レジの画面を使えない', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: { register_enabled: false, handy_enabled: true, display_limit: 2 }, error: null }) });
    expect((await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.contractOff.register);
    expect((await peekRegisterDevice(STORE, CONTRACT)).decision).toEqual({ kind: 'contract_off' });
    // 台数を数えていない店舗でも、契約の行があって OFF なら止める
    const zero = policyFrom({ register_limit: 0 });
    expect((await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: zero })).error).toBe(DEVICE_MESSAGE.contractOff.register);
  });

  it('migration の後・台数いっぱい：新しい iPad は承認待ちにもせず断る', async () => {
    h.state.ready = true;
    world({ register_devices: (c) => (c.head ? { count: c.filters.approval_status === 'approved' ? 2 : 0, data: null, error: null } : { data: null, error: null }) });
    expect((await gateRegisterLogin({ organizationId: ORG, storeId: STORE, userAgent: null, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.limit.register);
    expect(inserts('register_devices')).toHaveLength(0);
  });
});

describe('ハンディ：QR を読んだ端末（gateHandyJoin）', () => {
  const input = (policy: StoreAccessPolicy = NO_CONTRACT) => ({
    organizationId: ORG,
    storeId: STORE,
    policy,
    deviceName: 'iPhone（QR）',
    ip: '203.0.113.10',
    userAgent: 'iPhone',
    createdBy: null,
  });

  it('migration の前：legacy（呼び出し側が今まで通りに作る）', async () => {
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'legacy' });
    expect(await handyContractOff(STORE, CONTRACT)).toBe(false);
  });

  it('新しい端末：承認待ちで作る（所属は止めておく・ログイン状態は渡さない・端末の鍵を Cookie に）', async () => {
    h.state.ready = true;
    world({ handy_devices: (c) => (c.op === 'insert' ? { data: { id: DEVICE }, error: null } : c.head ? { count: 0 } : { data: null, error: null }), memberships: () => ({ data: { id: 'm1' }, error: null }) });
    const g = await gateHandyJoin(admin, input());
    expect(g).toMatchObject({ kind: 'pending', deviceId: DEVICE, message: DEVICE_MESSAGE.pendingHandy });
    expect(inserts('memberships')[0].payload).toMatchObject({ status: 'suspended', role: 'part_time' });
    const dev = inserts('handy_devices')[0].payload!;
    expect(dev).toMatchObject({ approval_status: 'pending', store_id: STORE });
    const cookie = h.state.setCookies.find((c) => c.name === HANDY_DEVICE_COOKIE)!;
    expect(cookie.options).toMatchObject({ httpOnly: true });
    expect(dev.device_token_hash).toBe(hashHandyDeviceToken(cookie.value));
    expect(h.state.signedIn).toHaveLength(0);
  });

  it('承認待ちの端末がもう一度読む → 承認待ち。却下・運営が解除 → 使えない', async () => {
    h.state.ready = true;
    h.state.cookies.set(HANDY_DEVICE_COOKIE, TOKEN);
    let approval = 'pending';
    world({
      handy_devices: (c) =>
        c.filters.device_token_hash
          ? { data: { id: DEVICE, store_id: STORE, status: 'active', approval_status: approval, profile_id: 'p1', membership_id: 'm1' }, error: null }
          : c.head
            ? { count: 0 }
            : { data: null, error: null },
    });
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.pendingHandy });
    approval = 'rejected';
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.rejected });
    approval = 'revoked';
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.revoked });
    expect(inserts('handy_devices')).toHaveLength(0);
  });

  it('承認済みで Wi-Fi の外の自動ログアウトなどで止まった端末：使い直してログイン（承認し直し不要）', async () => {
    h.state.ready = true;
    h.state.cookies.set(HANDY_DEVICE_COOKIE, TOKEN);
    world({
      handy_devices: (c) =>
        c.filters.device_token_hash === hashHandyDeviceToken(TOKEN)
          ? { data: { id: DEVICE, store_id: STORE, status: 'revoked', approval_status: 'approved', profile_id: 'p1', membership_id: 'm1' }, error: null }
          : c.head
            ? { count: 1 }
            : { data: null, error: null },
    });
    const g = await gateHandyJoin(admin, input(CONTRACT));
    expect(g).toEqual({ kind: 'signed_in', deviceId: DEVICE, reactivated: true });
    expect(updates('handy_devices')[0].payload).toMatchObject({ status: 'active', revoked_at: null });
    expect(updates('memberships')[0]).toMatchObject({ payload: { status: 'active' }, filters: { id: 'm1' } });
    expect(h.state.signedIn).toEqual(['h-handy-p1@devices.tenpo-one.com']);
  });

  it('ハンディの契約 OFF・台数いっぱい', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: { register_enabled: true, handy_enabled: false, display_limit: 2 }, error: null }) });
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.contractOff.handy });
    expect(await handyContractOff(STORE, CONTRACT)).toBe(true);
    // 契約の行が無い店舗は OFF にならない
    expect(await handyContractOff(STORE, NO_CONTRACT)).toBe(false);
    world({ handy_devices: (c) => (c.head ? { count: c.filters.approval_status === 'approved' ? 2 : 0 } : { data: null, error: null }) });
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.limit.handy });
  });

  it('いまログインしている承認済みの端末に鍵を入れる（無いときだけ）。migration の前は何もしない', async () => {
    await ensureHandyDeviceToken(DEVICE);
    expect(h.state.setCookies).toHaveLength(0);
    // migration を適用した（未適用と覚えているのを忘れる＝1 分後と同じ）
    resetDeviceControlSchemaCache();
    h.state.ready = true;
    let hash: string | null = null;
    world({ handy_devices: (c) => (c.op === 'select' ? { data: { id: DEVICE, status: 'active', approval_status: 'approved', device_token_hash: hash }, error: null } : { data: null, error: null }) });
    await ensureHandyDeviceToken(DEVICE);
    const cookie = h.state.setCookies.find((c) => c.name === HANDY_DEVICE_COOKIE)!;
    expect(updates('handy_devices')[0].payload).toEqual({ device_token_hash: hashHandyDeviceToken(cookie.value) });
    // 鍵が合っていれば書き直さない
    hash = hashHandyDeviceToken(cookie.value);
    h.state.setCookies = [];
    await ensureHandyDeviceToken(DEVICE);
    expect(h.state.setCookies).toHaveLength(0);
  });
});

describe('テーブルQR の ON/OFF の読み込み（lib/qr-order-flag-server.ts）', () => {
  it('店舗の表が無い（migration 00103 の前）・行が無い＝今まで通り ON', async () => {
    world({ store_feature_flags: () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.store_feature_flags' in the schema cache" } }) });
    expect(await loadQrOrderFlag(ORG, STORE)).toEqual({ on: true, reason: 'on' });
    world();
    expect(await loadQrOrderFlag(ORG, STORE)).toEqual({ on: true, reason: 'on' });
  });
  it('店舗の OFF・企業の OFF', async () => {
    world({ store_feature_flags: () => ({ data: { enabled: false }, error: null }) });
    expect(await loadQrOrderFlag(ORG, STORE)).toEqual({ on: false, reason: 'store_off' });
    world({ feature_flags: () => ({ data: { enabled: false }, error: null }), store_feature_flags: () => ({ data: { enabled: true }, error: null }) });
    expect(await loadQrOrderFlag(ORG, STORE)).toEqual({ on: false, reason: 'company_off' });
  });
  it('読み込みで例外が出てもお客様の注文は止めない（ON）', async () => {
    h.state.throwOn = 'feature_flags';
    expect(await loadQrOrderFlag(ORG, STORE)).toEqual({ on: true, reason: 'on' });
  });
});

// createClient の差し替えが効いていること（ensureHandyDeviceToken などが使う）
it('テストの差し替え', async () => {
  expect(await createClient()).toBe(h.client);
});
