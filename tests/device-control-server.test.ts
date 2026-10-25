import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * コントロールセンター（2026-10-25）のサーバー側を、Supabase・Cookie を差し替えて確かめる。
 *   - migration 00104 の列が無い間は今まで通り（lib/schema-compat.ts と同じ「列が無い」の見分け方）
 *   - migration の後も、運営が承認制を ON にしていない店舗は今まで通り（既定 OFF）。ON から 7 日間は移行期間
 *   - レジ（iPad）：ログインは今まで通り端末を見ない（契約 OFF・運営の却下／解除・承認待ちだけ止める）。レジの画面で登録
 *   - ハンディ：QR を読んだ端末（承認制 ON なら承認待ち・承認済みは使い直す・店舗が解除した端末は新しい端末・端末の鍵）
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
  const NEW_COLUMNS = /approval_status|approved_at|approved_by|approval_requested_at|register_enabled|handy_enabled|display_limit|approval_since|device_token_hash/;
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
  deviceControlStatus,
  hashHandyDeviceToken,
  isMissingDeviceControlSchema,
  loadContractColumns,
  readDeviceApproval,
  resetDeviceControlSchemaCache,
  selectDevicesWithApproval,
} from '@/lib/device-control-server';
import { checkRegisterDevice, gateRegisterLogin, hashDeviceToken, peekRegisterDevice } from '@/lib/store-access-server';
import { ensureHandyDeviceToken, gateHandyJoin, handyContractOff, signInApprovedHandy } from '@/lib/handy-device-approval-server';
import { loadQrOrderFlag } from '@/lib/qr-order-flag-server';
import { ACCESS_MESSAGE, policyFrom, REGISTER_COOKIE, type StoreAccessPolicy } from '@/lib/store-access';
import { DEFAULT_CONTRACT_COLUMNS, DEVICE_MESSAGE, HANDY_DEVICE_COOKIE } from '@/lib/device-control';
import { createClient } from '@/lib/supabase/server';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'ab'.repeat(24);
const admin = h.client as unknown as Parameters<typeof loadContractColumns>[0];

/** 契約の行（store_access_policies）がある店舗。台数2 */
const CONTRACT: StoreAccessPolicy = policyFrom({ register_limit: 2, handy_limit: 2 });
const NO_CONTRACT: StoreAccessPolicy = policyFrom(null);
/** 承認制を ON にしてから 7 日より前（移行期間が終わっている）／いま ON にした（移行期間） */
const LONG_AGO = '2026-01-01T00:00:00Z';
const JUST_NOW = () => new Date(Date.now() - 60_000).toISOString();

/** 表ごとの返事。count は head の数え上げ */
function world(tables: Partial<Record<string, (c: Call) => Res>> = {}) {
  h.state.respond = (c: Call) => {
    const f = tables[c.table];
    if (f) return f(c);
    if (c.head) return { data: null, error: null, count: 0 };
    return { data: null, error: null };
  };
}

/** 契約の列の返事（承認制など） */
const contractRow = (over: Row = {}) => ({ register_enabled: true, handy_enabled: true, display_limit: null, ...over });

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
    expect(await deviceControlStatus(admin)).toBe('missing');
    const probes = h.state.calls.length;
    expect(probes).toBe(4);
    expect(await deviceControlReady(admin)).toBe(false);
    expect(h.state.calls.length).toBe(probes);
  });

  it('列がある＝適用済み（以後は確かめない）', async () => {
    h.state.ready = true;
    expect(await deviceControlStatus(admin)).toBe('ready');
    const probes = h.state.calls.length;
    expect(await deviceControlReady(admin)).toBe(true);
    expect(h.state.calls.length).toBe(probes);
  });

  it('列が無いのとは別のエラー（通信など）は error（覚えずに、次の呼び出しで確かめ直す）', async () => {
    h.state.ready = true;
    world({ register_devices: () => ({ data: null, error: { code: '08006', message: 'connection reset' } }) });
    expect(await deviceControlStatus(admin)).toBe('error');
    expect(await deviceControlReady(admin)).toBe(false);
    world();
    expect(await deviceControlStatus(admin)).toBe('ready');
  });

  it('列・表が無いエラーの見分け方', () => {
    expect(isMissingDeviceControlSchema({ code: '42703', message: 'column register_devices.approval_status does not exist' })).toBe(true);
    expect(isMissingDeviceControlSchema({ message: "Could not find the 'handy_approval_since' column of 'store_access_policies' in the schema cache" })).toBe(true);
    expect(isMissingDeviceControlSchema({ code: 'PGRST205', message: "Could not find the table 'public.display_devices' in the schema cache" })).toBe(true);
    expect(isMissingDeviceControlSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingDeviceControlSchema(null)).toBe(false);
  });

  it('契約の列：未適用・行が無い・読めないときは ON・数えない・承認制 OFF', async () => {
    expect(await loadContractColumns(admin, STORE, false)).toEqual(DEFAULT_CONTRACT_COLUMNS);
    expect(h.state.calls.length).toBe(0);
    expect(await loadContractColumns(admin, STORE, true)).toEqual(DEFAULT_CONTRACT_COLUMNS);
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow({ register_enabled: false, display_limit: 3, handy_approval_since: LONG_AGO }), error: null }) });
    expect(await loadContractColumns(admin, STORE, true)).toEqual({
      registerEnabled: false,
      handyEnabled: true,
      displayLimit: 3,
      approvalSince: { register: null, handy: LONG_AGO, display: null },
    });
  });

  it('台数：未適用は使用中の台数だけ。適用後は承認済みと、最近（24時間）の承認待ちを分けて数える', async () => {
    world({ handy_devices: (c) => ({ count: c.filters.approval_status === 'pending' ? 1 : 3, data: null, error: null }) });
    expect(await countStoreDevices(admin, 'handy', STORE, false)).toEqual({ approvedActive: 3, pending: 0 });
    const legacy = h.state.calls.at(-1)!;
    expect(legacy.filters).toEqual({ store_id: STORE, status: 'active' });
    h.state.ready = true;
    expect(await countStoreDevices(admin, 'handy', STORE, true)).toEqual({ approvedActive: 3, pending: 1 });
    const pendingQuery = h.state.calls.find((c) => c.filters.approval_status === 'pending')!;
    const since = Date.parse(pendingQuery.filters['gt:approval_requested_at'] as string);
    expect(Date.now() - since).toBeGreaterThan(23 * 3600_000);
    expect(Date.now() - since).toBeLessThan(25 * 3600_000);
  });

  it('一覧：承認の列が無ければ外して読み直し、承認済みとして返す', async () => {
    world({ handy_devices: () => ({ data: [{ id: DEVICE, name: 'ホール1' }], error: null }) });
    const run = (columns: string) =>
      (h.client.from('handy_devices') as unknown as { select: (c: string) => PromiseLike<{ data: unknown; error: null }> }).select(columns);
    const legacy = await selectDevicesWithApproval(run, 'id, name');
    expect(legacy.ready).toBe(false);
    expect(legacy.rows).toEqual([{ id: DEVICE, name: 'ホール1', approval: 'approved', approvedAt: null, approvedBy: null }]);
    h.state.ready = true;
    world({ handy_devices: () => ({ data: [{ id: DEVICE, name: 'ホール1', approval_status: 'pending', approved_at: null, approved_by: null }], error: null }) });
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

describe('レジ（iPad）：ログインとレジの画面での端末の判定', () => {
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
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});
    expect(inserts('register_devices')).toHaveLength(0);
  });

  it('migration の後・承認制 OFF（既定）：今まで通り（ログインは端末を見ない・レジの画面の登録はそのまま使える）', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow(), error: null }) });
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});
    expect(inserts('register_devices')).toHaveLength(0);
    expect(h.state.setCookies).toHaveLength(0);
    const r = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', createdBy: null, policy: CONTRACT });
    expect(r.decision).toEqual({ kind: 'allowed' });
    const payload = inserts('register_devices')[0].payload!;
    expect(payload).not.toHaveProperty('approval_status');
    expect(payload).not.toHaveProperty('approved_at');
  });

  it('migration の後・台数いっぱいの店舗の 3台目の iPad（フロア・予約だけで使う）もログインできる（台数はレジの画面で見る）', async () => {
    h.state.ready = true;
    world({
      store_access_policies: () => ({ data: contractRow({ register_approval_since: LONG_AGO }), error: null }),
      register_devices: (c) => (c.head ? { count: c.filters.approval_status === 'approved' ? 2 : 0, data: null, error: null } : { data: null, error: null }),
    });
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});
    const r = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: null, createdBy: null, policy: CONTRACT });
    expect(r.decision).toEqual({ kind: 'limit', limit: 2 });
    expect(inserts('register_devices')).toHaveLength(0);
  });

  it('契約の行が無い店舗：台数も承認も見ない', async () => {
    h.state.ready = true;
    expect(await peekRegisterDevice(STORE, NO_CONTRACT)).toEqual({ decision: { kind: 'allowed' }, limit: 2, approval: false });
    expect(await gateRegisterLogin({ storeId: STORE, policy: NO_CONTRACT })).toEqual({});
    expect(inserts('register_devices')).toHaveLength(0);
  });

  it('承認制 ON（移行期間のあと）：知らない iPad もログインはでき、レジの画面の登録で承認待ちになる（Cookie に目印・監査ログ）', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow({ register_approval_since: LONG_AGO }), error: null }) });
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});
    expect((await peekRegisterDevice(STORE, CONTRACT)).decision).toEqual({ kind: 'register' });
    const r = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', createdBy: 'mgr', policy: CONTRACT });
    expect(r.decision).toEqual({ kind: 'pending' });
    expect(r.approval).toBe(true);
    const [ins] = inserts('register_devices');
    expect(ins.payload).toMatchObject({ store_id: STORE, approval_status: 'pending', organization_id: ORG });
    expect(ins.payload?.token_hash).toBe(hashDeviceToken(r.newToken!));
    expect(h.state.rpc.some((a) => a.p_action === 'device.register_request')).toBe(true);
  });

  it('承認制の移行期間：今まで通りすぐ使える iPad として登録し、自動承認の印を付ける', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow({ register_approval_since: JUST_NOW() }), error: null }) });
    const r = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: 'iPad', createdBy: null, policy: CONTRACT });
    expect(r.decision).toEqual({ kind: 'allowed' });
    expect(inserts('register_devices')[0].payload).toMatchObject({ approval_status: 'approved' });
    expect(inserts('register_devices')[0].payload?.approved_at).toBeTruthy();
  });

  it('ログインで止めるのは 承認待ち・運営の解除 だけ。承認済み・店舗が解除した（今までの）iPad はログインできる', async () => {
    h.state.ready = true;
    h.state.cookies.set(REGISTER_COOKIE, TOKEN);
    let approval = 'pending';
    let status = 'active';
    world({
      store_access_policies: () => ({ data: contractRow({ register_approval_since: LONG_AGO }), error: null }),
      register_devices: (c) =>
        c.filters.token_hash ? { data: { id: DEVICE, store_id: STORE, status, approval_status: approval }, error: null } : { data: null, error: null },
    });
    expect((await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.pendingRegister);
    expect((await peekRegisterDevice(STORE, CONTRACT)).decision).toEqual({ kind: 'pending' });

    approval = 'approved';
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});

    // 店舗が解除した（今までの）iPad：ログインは今まで通りでき、レジの画面で今までの文
    status = 'revoked';
    expect(await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).toEqual({});
    const peek = await peekRegisterDevice(STORE, CONTRACT);
    expect(peek.decision).toEqual({ kind: 'revoked', by: 'store' });

    approval = 'revoked';
    expect((await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.revoked);
    approval = 'rejected';
    expect((await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.rejected);
    expect(inserts('register_devices')).toHaveLength(0);
    expect(h.state.setCookies).toHaveLength(0);
    expect(ACCESS_MESSAGE.revoked).toContain('レジとして解除');
  });

  it('レジの契約 OFF：承認済みの iPad でもログイン・レジの画面を使えない', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow({ register_enabled: false }), error: null }) });
    expect((await gateRegisterLogin({ storeId: STORE, policy: CONTRACT })).error).toBe(DEVICE_MESSAGE.contractOff.register);
    expect((await peekRegisterDevice(STORE, CONTRACT)).decision).toEqual({ kind: 'contract_off' });
    const zero = policyFrom({ register_limit: 0 });
    expect((await gateRegisterLogin({ storeId: STORE, policy: zero })).error).toBe(DEVICE_MESSAGE.contractOff.register);
  });

  it('承認待ちの登録に失敗したとき・承認の列を確かめられないときは「もう一度」（承認なしで作らない）', async () => {
    h.state.ready = true;
    world({
      store_access_policies: () => ({ data: contractRow({ register_approval_since: LONG_AGO }), error: null }),
      register_devices: (c) => (c.op === 'insert' ? { data: null, error: { message: 'insert failed' } } : c.head ? { count: 0 } : { data: null, error: null }),
    });
    const failed = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: null, createdBy: null, policy: CONTRACT });
    expect(failed.error).toBe(DEVICE_MESSAGE.retry);
    expect(failed.newToken).toBeNull();

    resetDeviceControlSchemaCache();
    h.state.calls = [];
    world({ handy_devices: () => ({ data: null, error: { code: '08006', message: 'connection reset' } }) });
    const unsure = await checkRegisterDevice({ organizationId: ORG, storeId: STORE, userAgent: null, createdBy: null, policy: CONTRACT });
    expect(unsure.error).toBe(DEVICE_MESSAGE.retry);
    expect(inserts('register_devices')).toHaveLength(0);
  });
});

describe('ハンディ：QR を読んだ端末（gateHandyJoin）', () => {
  const input = (policy: StoreAccessPolicy = NO_CONTRACT, legacyLimit = true) => ({
    organizationId: ORG,
    storeId: STORE,
    policy,
    deviceName: 'iPhone（QR）',
    ip: '203.0.113.10',
    userAgent: 'iPhone',
    createdBy: null,
    legacyLimit,
  });
  const created = (c: Call) => (c.op === 'insert' ? { data: { id: DEVICE }, error: null } : c.head ? { count: 0 } : { data: null, error: null });

  it('migration の前：legacy（呼び出し側が今まで通りに作る）', async () => {
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'legacy' });
    expect(await handyContractOff(STORE, CONTRACT)).toBe(false);
  });

  it('migration の後・承認制 OFF（既定）：新しい端末も今まで通りすぐ使える（端末の鍵は入れておく）', async () => {
    h.state.ready = true;
    world({ handy_devices: created, memberships: () => ({ data: { id: 'm1' }, error: null }) });
    const g = await gateHandyJoin(admin, input());
    expect(g).toMatchObject({ kind: 'approved', deviceId: DEVICE, created: true });
    expect(inserts('memberships')[0].payload).toMatchObject({ status: 'active' });
    const dev = inserts('handy_devices')[0].payload!;
    expect(dev).not.toHaveProperty('approval_status');
    const cookie = h.state.setCookies.find((c) => c.name === HANDY_DEVICE_COOKIE)!;
    expect(dev.device_token_hash).toBe(hashHandyDeviceToken(cookie.value));
    if (g.kind === 'approved') await signInApprovedHandy(admin, g);
    expect(h.state.signedIn).toHaveLength(1);
  });

  it('Wi-Fi だけの店で夜にログアウトした（鍵を持たない）端末：承認制 OFF なら翌朝も今まで通り入れる', async () => {
    h.state.ready = true;
    world({ handy_devices: (c) => (c.head ? { count: c.filters.approval_status === 'pending' ? 9 : 0 } : created(c)), memberships: () => ({ data: { id: 'm1' }, error: null }) });
    // 承認待ちが何台あっても関係ない（承認制 OFF）
    expect((await gateHandyJoin(admin, input())).kind).toBe('approved');
  });

  it('承認制の移行期間：新しい端末もすぐ使える（自動承認の印）', async () => {
    h.state.ready = true;
    world({
      store_access_policies: () => ({ data: contractRow({ handy_approval_since: JUST_NOW() }), error: null }),
      handy_devices: created,
      memberships: () => ({ data: { id: 'm1' }, error: null }),
    });
    const g = await gateHandyJoin(admin, input(CONTRACT));
    expect(g.kind).toBe('approved');
    expect(inserts('handy_devices')[0].payload).toMatchObject({ approval_status: 'approved' });
    expect(inserts('handy_devices')[0].payload?.approved_at).toBeTruthy();
  });

  it('承認制 ON：新しい端末は承認待ち（所属は止めておく・ログイン状態は渡さない・端末の鍵を Cookie に）', async () => {
    h.state.ready = true;
    world({
      store_access_policies: () => ({ data: contractRow({ handy_approval_since: LONG_AGO }), error: null }),
      handy_devices: created,
      memberships: () => ({ data: { id: 'm1' }, error: null }),
    });
    const g = await gateHandyJoin(admin, input(CONTRACT));
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
      store_access_policies: () => ({ data: contractRow({ handy_approval_since: LONG_AGO }), error: null }),
      handy_devices: (c) =>
        c.filters.device_token_hash
          ? { data: { id: DEVICE, store_id: STORE, status: 'active', approval_status: approval, profile_id: 'p1', membership_id: 'm1', revoked_by: null }, error: null }
          : c.head
            ? { count: 0 }
            : { data: null, error: null },
    });
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.pendingHandy });
    approval = 'rejected';
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.rejected });
    approval = 'revoked';
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.revoked });
    expect(inserts('handy_devices')).toHaveLength(0);
  });

  it('承認済みで Wi-Fi の外の自動ログアウトで止まった端末（鍵あり）：承認制 ON でも使い直してログイン', async () => {
    h.state.ready = true;
    h.state.cookies.set(HANDY_DEVICE_COOKIE, TOKEN);
    world({
      store_access_policies: () => ({ data: contractRow({ handy_approval_since: LONG_AGO }), error: null }),
      handy_devices: (c) =>
        c.filters.device_token_hash === hashHandyDeviceToken(TOKEN)
          ? { data: { id: DEVICE, store_id: STORE, status: 'revoked', approval_status: 'approved', profile_id: 'p1', membership_id: 'm1', revoked_by: null }, error: null }
          : c.head
            ? { count: 1 }
            : { data: null, error: null },
    });
    const g = await gateHandyJoin(admin, input(CONTRACT));
    expect(g).toEqual({ kind: 'approved', deviceId: DEVICE, profileId: 'p1', membershipId: 'm1', email: null, reactivate: true, created: false });
    if (g.kind === 'approved') expect(await signInApprovedHandy(admin, g)).toEqual({});
    expect(updates('handy_devices')[0].payload).toMatchObject({ status: 'active', revoked_at: null });
    expect(updates('memberships')[0]).toMatchObject({ payload: { status: 'active' }, filters: { id: 'm1' } });
    expect(h.state.signedIn).toEqual(['h-handy-p1@devices.tenpo-one.com']);
  });

  it('店舗が解除した端末（なくした端末）は使い直さない：新しい端末として扱う（承認制 ON なら承認待ち）', async () => {
    h.state.ready = true;
    h.state.cookies.set(HANDY_DEVICE_COOKIE, TOKEN);
    world({
      store_access_policies: () => ({ data: contractRow({ handy_approval_since: LONG_AGO }), error: null }),
      handy_devices: (c) =>
        c.filters.device_token_hash
          ? { data: { id: 'old', store_id: STORE, status: 'revoked', approval_status: 'approved', profile_id: 'p1', membership_id: 'm1', revoked_by: 'mgr' }, error: null }
          : created(c),
      memberships: () => ({ data: { id: 'm2' }, error: null }),
    });
    const g = await gateHandyJoin(admin, input(CONTRACT));
    expect(g.kind).toBe('pending');
    expect(updates('handy_devices').filter((u) => u.filters.id === 'old')).toHaveLength(0);
  });

  it('ハンディの契約 OFF・台数いっぱい（端末ごとの QR は承認制 ON のときだけ台数を見る）・確かめられないとき', async () => {
    h.state.ready = true;
    world({ store_access_policies: () => ({ data: contractRow({ handy_enabled: false }), error: null }) });
    expect(await gateHandyJoin(admin, input(CONTRACT))).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.contractOff.handy });
    expect(await handyContractOff(STORE, CONTRACT)).toBe(true);
    expect(await handyContractOff(STORE, NO_CONTRACT)).toBe(false);

    world({
      store_access_policies: () => ({ data: contractRow(), error: null }),
      handy_devices: (c) => (c.head ? { count: c.filters.approval_status === 'approved' ? 2 : 0 } : created(c)),
      memberships: () => ({ data: { id: 'm1' }, error: null }),
    });
    // 固定 QR：今まで通り台数を見る（今までと同じ文）
    expect(await gateHandyJoin(admin, input(CONTRACT, true))).toEqual({ kind: 'blocked', message: ACCESS_MESSAGE.handyLimit });
    // 端末ごとの QR：今まで台数を見ていなかった（承認制 OFF なら今まで通り）
    expect((await gateHandyJoin(admin, input(CONTRACT, false))).kind).toBe('approved');

    resetDeviceControlSchemaCache();
    world({ register_devices: () => ({ data: null, error: { code: '08006', message: 'connection reset' } }) });
    expect(await gateHandyJoin(admin, input())).toEqual({ kind: 'blocked', message: DEVICE_MESSAGE.retry });
  });

  it('いまログインしている承認済みの端末に鍵を入れる（無いときだけ）。migration の前は何もしない', async () => {
    await ensureHandyDeviceToken(DEVICE);
    expect(h.state.setCookies).toHaveLength(0);
    resetDeviceControlSchemaCache();
    h.state.ready = true;
    let hash: string | null = null;
    world({ handy_devices: (c) => (c.op === 'select' ? { data: { id: DEVICE, status: 'active', approval_status: 'approved', device_token_hash: hash }, error: null } : { data: null, error: null }) });
    await ensureHandyDeviceToken(DEVICE);
    const cookie = h.state.setCookies.find((c) => c.name === HANDY_DEVICE_COOKIE)!;
    expect(updates('handy_devices')[0].payload).toEqual({ device_token_hash: hashHandyDeviceToken(cookie.value) });
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
