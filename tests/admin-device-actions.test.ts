import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * コントロールセンター（運営コンソール）の操作（app/admin/tenants/device-actions.ts）。
 * 承認（契約 OFF・台数いっぱいは断る）・却下・解除・契約の保存・テーブルQR の ON/OFF と、監査ログ。
 */

type Row = Record<string, unknown>;
interface Call {
  table: string;
  op: string;
  filters: Row;
  payload: Row | null;
  columns?: string;
  head?: boolean;
}
interface Res {
  data?: unknown;
  error?: unknown;
  count?: number;
}

const h = vi.hoisted(() => {
  const state = {
    ready: true,
    calls: [] as Call[],
    rpc: [] as Row[],
    respond: ((): Res => ({ data: null, error: null })) as (c: Call) => Res,
    policy: { exists: true, networks: [], networkEnforced: false, registerLimit: 2, handyLimit: 2, note: '' } as Row,
    displayOn: true,
    signedOut: [] as string[],
    suspended: [] as string[],
    displayCalls: [] as unknown[][],
  };
  const NEW_COLUMNS = /approval_status|register_enabled|handy_enabled|display_limit|device_token_hash/;
  const makeBuilder = (table: string) => {
    const call: Call = { table, op: 'select', filters: {}, payload: null };
    const done = (): Res => {
      state.calls.push(call);
      const m = NEW_COLUMNS.exec(call.columns ?? '') ?? NEW_COLUMNS.exec(JSON.stringify(call.payload ?? {}));
      if (!state.ready && m) return { data: null, error: { code: '42703', message: `column ${table}.${m[0]} does not exist` } };
      return state.respond(call);
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: (cols?: unknown, opts?: { head?: boolean }) => {
        if (typeof cols === 'string' && call.op === 'select') call.columns = cols;
        if (opts?.head) call.head = true;
        return q;
      },
      limit: () => q,
      order: () => q,
      insert: (p: Row) => ((call.op = 'insert'), (call.payload = p), q),
      update: (p: Row) => ((call.op = 'update'), (call.payload = p), q),
      upsert: (p: Row) => ((call.op = 'upsert'), (call.payload = p), q),
      eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
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
      admin: {
        signOut: async (id: string) => {
          state.signedOut.push(id);
          return { error: null };
        },
      },
    },
  };
  return { state, client };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/auth', () => ({ requireCypressAdmin: async () => ({ userId: 'operator-1', isCypressAdmin: true }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }));
vi.mock('@/lib/store-access-server', () => ({ loadStorePolicy: async () => h.state.policy }));
vi.mock('@/lib/display-monitor-server', () => ({
  loadDisplayMonitorFlag: async () => (h.state.displayOn ? { on: true, reason: 'on' } : { on: false, reason: 'store_off' }),
}));
vi.mock('@/lib/display-ops-server', () => ({
  suspendDisplayAccount: async (_admin: unknown, id: string) => {
    h.state.suspended.push(id);
  },
}));
vi.mock('@/app/admin/organizations/display-actions', () => ({
  setOrgDisplayMonitor: async (...a: unknown[]) => void h.state.displayCalls.push(['org', ...a]),
  setStoreDisplayMonitor: async (...a: unknown[]) => void h.state.displayCalls.push(['store', ...a]),
}));

import { approveStoreDevice, rejectStoreDevice, revokeStoreDevice, saveStoreDeviceContract, setStoreQrOrder } from '@/app/admin/tenants/device-actions';
import { resetDeviceControlSchemaCache } from '@/lib/device-control-server';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000c1';

function world(device: Row | null, opts: { approvedCount?: number; contract?: Row } = {}) {
  h.state.respond = (c: Call) => {
    if (c.table === 'stores') return { data: { id: STORE, name: '新宿店', organization_id: ORG }, error: null };
    if (c.table === 'store_access_policies' && c.op === 'select') return { data: opts.contract ?? null, error: null };
    if (['register_devices', 'handy_devices', 'display_devices'].includes(c.table)) {
      if (c.head) return { data: null, error: null, count: c.filters.approval_status === 'approved' ? (opts.approvedCount ?? 0) : 0 };
      if (c.op === 'select' && c.filters.id) return { data: device, error: null };
    }
    if (c.table === 'store_feature_flags' && c.op === 'select') return { data: null, error: null };
    return { data: null, error: null };
  };
}
const updatesOf = (table: string) => h.state.calls.filter((c) => c.table === table && c.op === 'update');

beforeEach(() => {
  resetDeviceControlSchemaCache();
  h.state.ready = true;
  h.state.calls = [];
  h.state.rpc = [];
  h.state.policy = { exists: true, networks: [], networkEnforced: false, registerLimit: 2, handyLimit: 2, note: '' };
  h.state.displayOn = true;
  h.state.signedOut = [];
  h.state.suspended = [];
  h.state.displayCalls = [];
  world(null);
});

const handyPending = { id: DEVICE, store_id: STORE, name: 'iPhone', status: 'active', approval_status: 'pending', profile_id: 'p1', membership_id: 'm1' };

describe('承認', () => {
  it('承認待ちのハンディを承認：承認済みにして所属を戻し、監査ログに残す', async () => {
    world(handyPending, { approvedCount: 1 });
    expect(await approveStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).toEqual({});
    expect(updatesOf('handy_devices')[0].payload).toMatchObject({ approval_status: 'approved', approved_by: 'operator-1' });
    expect(updatesOf('memberships')[0]).toMatchObject({ payload: { status: 'active' }, filters: { id: 'm1' } });
    expect(h.state.rpc.at(-1)).toMatchObject({ p_action: 'admin.device_approve', p_store: STORE, p_target_table: 'handy_devices', p_target_id: DEVICE });
  });

  it('台数いっぱい・契約 OFF なら承認しない', async () => {
    world(handyPending, { approvedCount: 2 });
    expect((await approveStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toContain('契約台数（2台）');
    world(handyPending, { approvedCount: 0, contract: { register_enabled: true, handy_enabled: false, display_limit: 2 } });
    expect((await approveStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toContain('契約が OFF');
    h.state.displayOn = false;
    world({ ...handyPending, profile_id: 'p2' });
    expect((await approveStoreDevice({ storeId: STORE, type: 'display', deviceId: DEVICE })).error).toContain('ディスプレイ端末の契約が OFF');
    expect(updatesOf('handy_devices')).toHaveLength(0);
    expect(updatesOf('display_devices')).toHaveLength(0);
  });

  it('運営が解除したレジ（iPad）の承認し直し：使えるように戻す。解除済みのディスプレイはつなぎ直しが要る', async () => {
    world({ id: DEVICE, store_id: STORE, name: 'レジ端末', status: 'revoked', approval_status: 'revoked' });
    expect(await approveStoreDevice({ storeId: STORE, type: 'register', deviceId: DEVICE })).toEqual({});
    expect(updatesOf('register_devices')[0].payload).toMatchObject({ approval_status: 'approved', status: 'active', revoked_at: null });
    world({ ...handyPending, status: 'revoked' });
    expect((await approveStoreDevice({ storeId: STORE, type: 'display', deviceId: DEVICE })).error).toContain('つないでください');
  });

  it('migration の前は承認・却下できない（理由を返す）。別の店舗の端末は見つからない', async () => {
    h.state.ready = false;
    world(handyPending);
    expect((await approveStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toContain('migration 00104');
    expect((await rejectStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toContain('migration 00104');
    resetDeviceControlSchemaCache();
    h.state.ready = true;
    world({ ...handyPending, store_id: 'other' });
    expect((await approveStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toBe('端末が見つかりません');
    expect((await approveStoreDevice({ storeId: STORE, type: 'printer' as never, deviceId: DEVICE })).error).toContain('種類');
  });
});

describe('却下・解除', () => {
  it('却下：承認待ちだけ。ハンディはログイン状態を切り所属を止める', async () => {
    world(handyPending);
    expect(await rejectStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).toEqual({});
    expect(updatesOf('handy_devices')[0].payload).toMatchObject({ approval_status: 'rejected', status: 'revoked', revoked_by: 'operator-1' });
    expect(h.state.signedOut).toEqual(['p1']);
    expect(h.state.rpc.at(-1)).toMatchObject({ p_action: 'admin.device_reject' });
    world({ ...handyPending, approval_status: 'approved' });
    expect((await rejectStoreDevice({ storeId: STORE, type: 'handy', deviceId: DEVICE })).error).toContain('承認待ちではありません');
  });

  it('解除：ディスプレイは鍵を消してアカウントを止める。migration の前でも解除できる（承認の列は書かない）', async () => {
    world({ ...handyPending, approval_status: 'approved' });
    expect(await revokeStoreDevice({ storeId: STORE, type: 'display', deviceId: DEVICE })).toEqual({});
    expect(updatesOf('display_devices')[0].payload).toMatchObject({ status: 'revoked', approval_status: 'revoked', device_token_hash: null });
    expect(h.state.suspended).toEqual(['p1']);
    expect(h.state.rpc.at(-1)).toMatchObject({ p_action: 'admin.device_revoke' });

    resetDeviceControlSchemaCache();
    h.state.ready = false;
    h.state.calls = [];
    world({ id: DEVICE, store_id: STORE, name: 'レジ端末', status: 'active' });
    expect(await revokeStoreDevice({ storeId: STORE, type: 'register', deviceId: DEVICE })).toEqual({});
    const payload = updatesOf('register_devices')[0].payload!;
    expect(payload).toMatchObject({ status: 'revoked' });
    expect(payload).not.toHaveProperty('approval_status');
  });
});

describe('契約の保存・テーブルQR', () => {
  it('migration の後：ON/OFF・台数を保存し、ディスプレイの機能フラグも合わせる。監査ログ', async () => {
    h.state.displayOn = false;
    world(null);
    const r = await saveStoreDeviceContract({
      storeId: STORE,
      registerEnabled: false,
      registerLimit: 3,
      handyEnabled: true,
      handyLimit: 99,
      displayEnabled: true,
      displayLimit: 1,
    });
    expect(r).toEqual({});
    const up = h.state.calls.find((c) => c.table === 'store_access_policies' && c.op === 'upsert')!;
    expect(up.payload).toMatchObject({ store_id: STORE, register_enabled: false, register_limit: 3, handy_enabled: true, handy_limit: 20, display_limit: 1 });
    expect(h.state.displayCalls).toEqual([['store', ORG, STORE, true]]);
    expect(h.state.rpc.at(-1)).toMatchObject({ p_action: 'admin.device_contract' });
  });

  it('migration の前：台数だけ保存（ON/OFF の列は書かない）。OFF にしようとしたら知らせる', async () => {
    h.state.ready = false;
    world(null);
    const r = await saveStoreDeviceContract({ storeId: STORE, registerEnabled: false, registerLimit: 2, handyEnabled: true, handyLimit: 2, displayEnabled: true, displayLimit: 2 });
    expect(r.warning).toContain('migration 00104');
    const up = h.state.calls.find((c) => c.table === 'store_access_policies' && c.op === 'upsert')!;
    expect(up.payload).not.toHaveProperty('register_enabled');
  });

  it('テーブルQR：店舗の行を書く（行が無い＝ON）・監査ログ', async () => {
    world(null);
    expect(await setStoreQrOrder({ storeId: STORE, enabled: false })).toEqual({});
    const up = h.state.calls.find((c) => c.table === 'store_feature_flags' && c.op === 'upsert')!;
    expect(up.payload).toMatchObject({ store_id: STORE, organization_id: ORG, flag_key: 'qr_order', enabled: false });
    expect(h.state.rpc.at(-1)).toMatchObject({ p_action: 'admin.qr_order_store', p_before: { enabled: true }, p_after: { enabled: false } });
  });
});
