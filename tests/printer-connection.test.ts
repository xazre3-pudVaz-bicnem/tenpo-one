import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * 「プリンター接続」（CloudPRNT・Server Direct Print・iPad）は運営（コントロールセンター /admin）で設定する（2026-10-25 Ronnie）。
 *   - lib/printer-connection.ts … 行・つなぎ方・接続用URL・状態・入力チェック（お店の画面と運営の画面で同じ）
 *   - lib/cloudprnt-test-job.ts … テスト印刷・ドロア開放のジョブ（お店と運営で同じ中身）
 *   - 運営の Server Action（app/admin/organizations/printer-connection-actions.ts）：運営だけ・その企業のその店舗のプリンターだけ
 *   - お店の管理画面（app/app/settings/printers/actions.ts）：設定は運営のアカウントだけ・テスト印刷はお店でも
 * Supabase・認証は差し替えて確かめる。
 */

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
interface Call {
  table: string;
  op: Op;
  filters: Row;
  payload: Row | null;
}
interface Res {
  data: unknown;
  error: unknown;
}

const h = vi.hoisted(() => {
  const state = {
    isAdmin: true,
    calls: [] as Call[],
    audits: [] as Row[],
    respond: ((): Res => ({ data: null, error: null })) as (c: Call) => Res,
    storeCtx: {
      userId: 'u-store',
      organizationId: '',
      role: 'store_manager',
      isHq: false,
      isCypressAdmin: false,
      isRegisterDevice: false,
      stores: [] as { id: string }[],
    },
  };
  const makeBuilder = (table: string) => {
    const call: Call = { table, op: 'select', filters: {}, payload: null };
    const done = (): Res => {
      state.calls.push(call);
      return state.respond(call);
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: self,
      neq: self,
      order: self,
      limit: self,
      insert: (p: Row) => ((call.op = 'insert'), (call.payload = p), q),
      update: (p: Row) => ((call.op = 'update'), (call.payload = p), q),
      upsert: (p: Row) => ((call.op = 'upsert'), (call.payload = p), q),
      delete: () => ((call.op = 'delete'), q),
      eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
      in: (k: string, v: unknown) => ((call.filters[`in:${k}`] = v), q),
      maybeSingle: async () => done(),
      single: async () => done(),
      then: (resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(done).then(resolve, reject),
    });
    return q;
  };
  const client = {
    from: (t: string) => makeBuilder(t),
    rpc: async (_fn: string, args: Row) => {
      state.audits.push(args);
      return { error: null };
    },
  };
  return { state, client };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }));
vi.mock('@/lib/auth', () => ({
  // 本物と同じく、運営でなければ /app/dashboard へ（redirect は例外で止まる）
  requireCypressAdmin: async () => {
    if (!h.state.isAdmin) throw new Error('NEXT_REDIRECT /app/dashboard');
    return { userId: 'u-admin', isCypressAdmin: true };
  },
  requirePermission: async () => h.state.storeCtx,
}));

import {
  canEditPrinterConnection,
  cloudPrntConfigPatch,
  drawerFieldOf,
  drawerPinLabel,
  drawerPinValue,
  isConnectionPrinterOf,
  kitchenStationsLabel,
  KITCHEN_STATIONS_REQUIRED,
  parsePrinterConnectionInput,
  parsePrinterConnectionTestInput,
  pendingJobsByPrinter,
  polledAgo,
  PRINTER_CONNECTION_ADMIN_NOTE,
  printerConnectionKind,
  printerConnectionKindLabel,
  printerConnectionRows,
  printerConnectionStatus,
  printerConnectionUrl,
  usesConnectionUrl,
  usesPollInterval,
  type PrinterConnectionDbRow,
} from '@/lib/printer-connection';
import { CLOUDPRNT_TEST_JOB, cloudPrntTestError, cloudPrntTestPayload, newCloudPrntToken } from '@/lib/cloudprnt-test-job';
import {
  enqueueAdminPrinterConnectionTest,
  regenerateAdminPrinterConnectionToken,
  saveAdminPrinterConnection,
} from '@/app/admin/organizations/printer-connection-actions';
import { enqueueCloudPrntTest, regenerateCloudPrntToken, setCloudPrntConfig } from '@/app/app/settings/printers/actions';
import { ADMIN_ONLY_MESSAGE } from '@/lib/admin-only-settings';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const OTHER_STORE = '00000000-0000-4000-8000-0000000000b2';
const RECEIPT_P = '00000000-0000-4000-8000-0000000000d1'; // Star・レシート・ドロア連動
const KITCHEN_P = '00000000-0000-4000-8000-0000000000d2'; // EPSON・厨房
const OFF_P = '00000000-0000-4000-8000-0000000000d3'; // 「使う」が OFF
const LABEL_P = '00000000-0000-4000-8000-0000000000d4'; // ラベル機（プリンター接続の対象外）

const SITE = 'https://tenpo.example';

const dbRow = (over: Partial<PrinterConnectionDbRow> = {}): PrinterConnectionDbRow => ({
  id: RECEIPT_P,
  name: 'レジ',
  maker: 'Star',
  model: 'mC-Print3',
  usage: 'receipt',
  connection_type: 'lan',
  cloudprnt_enabled: true,
  cloudprnt_token: 'tok_receipt_0123456789',
  drawer_kick: true,
  drawer_command: '[drawer: 1]',
  paper_width_mm: 80,
  poll_interval_seconds: 5,
  last_polled_at: '2026-10-25T09:00:00.000Z',
  mac_address: '00:11:62:aa:bb:cc',
  kitchen_stations: ['kitchen'],
  ...over,
});

/** DB の printer_configs の行（企業 ORG の店舗 STORE） */
const printers: Record<string, Row> = {
  [RECEIPT_P]: { id: RECEIPT_P, organization_id: ORG, store_id: STORE, status: 'active', name: 'レジ', usage: 'receipt', cloudprnt_enabled: true, paper_width_mm: 80, drawer_command: '[drawer: 1]', drawer_kick: true },
  [KITCHEN_P]: { id: KITCHEN_P, organization_id: ORG, store_id: STORE, status: 'active', name: '厨房', usage: 'kitchen', cloudprnt_enabled: true, paper_width_mm: 58, drawer_command: '[drawer: 1]', drawer_kick: false },
  [OFF_P]: { id: OFF_P, organization_id: ORG, store_id: STORE, status: 'active', name: '止めている', usage: 'receipt', cloudprnt_enabled: false, paper_width_mm: 80, drawer_command: '[drawer: 1]', drawer_kick: true },
  [LABEL_P]: { id: LABEL_P, organization_id: ORG, store_id: STORE, status: 'active', name: 'ラベル', usage: 'label', cloudprnt_enabled: true, paper_width_mm: 58, drawer_command: '[drawer: 1]', drawer_kick: false },
};

function world(over: Partial<Record<string, (c: Call) => Res>> = {}) {
  h.state.respond = (c: Call) => {
    const f = over[c.table];
    if (f) return f(c);
    if (c.op !== 'select') return { data: null, error: null };
    if (c.table === 'stores') {
      const id = c.filters.id;
      if (id === STORE) return { data: { id: STORE, organization_id: ORG, name: '新宿店' }, error: null };
      if (id === OTHER_STORE) return { data: { id: OTHER_STORE, organization_id: OTHER_ORG, name: '他社の店' }, error: null };
      return { data: null, error: null };
    }
    if (c.table === 'printer_configs') {
      const p = printers[c.filters.id as string];
      // お店の Server Action は store_id でも絞る
      if (p && c.filters.store_id && c.filters.store_id !== p.store_id) return { data: null, error: null };
      return { data: p ?? null, error: null };
    }
    return { data: null, error: null };
  };
}

beforeEach(() => {
  h.state.isAdmin = true;
  h.state.calls = [];
  h.state.audits = [];
  world();
  h.state.storeCtx = {
    userId: 'u-store',
    organizationId: ORG,
    role: 'store_manager',
    isHq: false,
    isCypressAdmin: false,
    isRegisterDevice: false,
    stores: [{ id: STORE }],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const writes = () => h.state.calls.filter((c) => c.op !== 'select');
const ref = (printerId = RECEIPT_P, over: Row = {}) => ({ organizationId: ORG, storeId: STORE, printerId, ...over });

// -------------------------------------------------------------
// lib/printer-connection.ts（純粋な関数）
// -------------------------------------------------------------

describe('printer-connection: つなぎ方・接続用URL', () => {
  it('つなぎ方：Bluetooth・USB は iPad、SII など は iPad LAN、EPSON は SDP、ほかは CloudPRNT（お店の画面と同じ判定）', () => {
    expect(printerConnectionKind({ maker: 'Star', connectionType: 'bluetooth' })).toBe('ipad');
    expect(printerConnectionKind({ maker: 'EPSON', connectionType: 'usb' })).toBe('ipad');
    expect(printerConnectionKind({ maker: 'SII', connectionType: 'lan' })).toBe('ipad-lan');
    expect(printerConnectionKind({ maker: 'EPSON', connectionType: 'wifi' })).toBe('sdp');
    expect(printerConnectionKind({ maker: 'Star', connectionType: 'lan' })).toBe('cloudprnt');
    // 今までの Star の行（メーカー空）は CloudPRNT のまま
    expect(printerConnectionKind({ maker: '', connectionType: null })).toBe('cloudprnt');

    expect(printerConnectionKindLabel({ maker: 'Star', connectionType: 'bluetooth' })).toBe('iPad Bluetooth');
    expect(printerConnectionKindLabel({ maker: 'Star', connectionType: 'usb' })).toBe('iPad USB');
    expect(printerConnectionKindLabel({ maker: 'SII', connectionType: 'lan' })).toBe('iPad LAN');
    expect(printerConnectionKindLabel({ maker: 'EPSON', connectionType: 'lan' })).toBe('EPSON SDP');
    expect(printerConnectionKindLabel({ maker: 'Star', connectionType: 'lan' })).toBe('CloudPRNT');

    expect(usesConnectionUrl('cloudprnt') && usesConnectionUrl('sdp')).toBe(true);
    expect(usesConnectionUrl('ipad') || usesConnectionUrl('ipad-lan')).toBe(false);
    expect(usesPollInterval('cloudprnt') && usesPollInterval('sdp')).toBe(true);
    expect(usesPollInterval('ipad') || usesPollInterval('ipad-lan')).toBe(false);
  });

  it('接続用URL：Star は /api/cloudprnt/、EPSON は /api/epson/（お店の画面と同じ形）。公開URL・トークンが無ければ空', () => {
    expect(printerConnectionUrl(SITE, 'Star', 'abc')).toBe(`${SITE}/api/cloudprnt/abc`);
    expect(printerConnectionUrl(SITE, 'epson', 'abc')).toBe(`${SITE}/api/epson/abc`);
    expect(printerConnectionUrl(SITE, null, 'abc')).toBe(`${SITE}/api/cloudprnt/abc`);
    expect(printerConnectionUrl('', 'Star', 'abc')).toBe('');
    expect(printerConnectionUrl(SITE, 'Star', null)).toBe('');
  });
});

describe('printer-connection: 状態', () => {
  const polled = '2026-10-25T09:00:00.000Z';
  const t = new Date(polled).getTime();
  it('最後の通信から 60 秒以内なら接続中（お店の画面と同じ判定）', () => {
    expect(printerConnectionStatus({ cloudprntEnabled: false, lastPolledAt: polled }, t)).toBe('disabled');
    expect(printerConnectionStatus({ cloudprntEnabled: true, lastPolledAt: null }, t)).toBe('never');
    expect(printerConnectionStatus({ cloudprntEnabled: true, lastPolledAt: polled }, 0)).toBe('checking');
    expect(printerConnectionStatus({ cloudprntEnabled: true, lastPolledAt: polled }, t + 60_000)).toBe('online');
    expect(printerConnectionStatus({ cloudprntEnabled: true, lastPolledAt: polled }, t + 60_001)).toBe('offline');
  });

  it('「何秒前」', () => {
    expect(polledAgo(polled, t + 12_000)).toBe('12秒前');
    expect(polledAgo(polled, t + 3 * 60_000)).toBe('3分前');
    expect(polledAgo(polled, t + 2 * 3600_000)).toBe('2時間前');
    expect(polledAgo(polled, t - 5_000)).toBe('0秒前');
  });
});

describe('printer-connection: 行と項目', () => {
  it('レシート・厨房だけ、レシート機が先。空の値は今までと同じ標準（間隔は 1 秒・ドロアは [drawer: 1]・伝票はキッチン）', () => {
    const rows = printerConnectionRows(
      [
        dbRow({ id: KITCHEN_P, name: '厨房', usage: 'kitchen', maker: null, model: null, kitchen_stations: null, poll_interval_seconds: null, drawer_command: null, cloudprnt_enabled: null }),
        dbRow({ id: LABEL_P, name: 'ラベル', usage: 'label' }),
        dbRow(),
      ],
      new Map([[RECEIPT_P, 2]])
    );
    expect(rows.map((r) => r.id)).toEqual([RECEIPT_P, KITCHEN_P]);
    expect(rows[0]).toMatchObject({ pendingJobs: 2, pollIntervalSeconds: 5, cloudprntToken: 'tok_receipt_0123456789', macAddress: '00:11:62:aa:bb:cc' });
    expect(rows[1]).toMatchObject({
      maker: '',
      model: '',
      cloudprntEnabled: false,
      pollIntervalSeconds: 1,
      drawerCommand: '[drawer: 1]',
      kitchenStations: ['kitchen'],
      pendingJobs: 0,
    });
    expect(pendingJobsByPrinter([{ printer_config_id: RECEIPT_P }, { printer_config_id: null }, { printer_config_id: RECEIPT_P }])).toEqual(new Map([[RECEIPT_P, 2]]));
  });

  it('ドロアの入れ方：EPSON・iPad LAN はピン、Star はコマンド、厨房機・ドロアなしは出さない', () => {
    expect(drawerFieldOf({ usage: 'receipt', drawerKick: true, maker: 'EPSON', connectionType: 'lan' })).toBe('pin');
    expect(drawerFieldOf({ usage: 'receipt', drawerKick: true, maker: 'SII', connectionType: 'lan' })).toBe('pin');
    expect(drawerFieldOf({ usage: 'receipt', drawerKick: true, maker: 'Star', connectionType: 'bluetooth' })).toBe('command');
    expect(drawerFieldOf({ usage: 'receipt', drawerKick: false, maker: 'Star' })).toBe('none');
    expect(drawerFieldOf({ usage: 'kitchen', drawerKick: true, maker: 'Star' })).toBe('none');
    expect(drawerPinValue('[drawer: 2]')).toBe('[drawer: 2]');
    expect(drawerPinValue('[drawer: 1]')).toBe('[drawer: 1]');
    expect(drawerPinLabel('[drawer: 2]')).toBe('5番ピン');
    expect(kitchenStationsLabel(['drink', 'kitchen'])).toBe('キッチン（フード）・ドリンク');
    expect(kitchenStationsLabel([])).toBe('—');
  });

  it('変えられるのは お店の管理画面と運営（STORE_CAN_EDIT_NETWORK_PRINTERS が ON の間）。レジ端末の iPad は不可', () => {
    expect(canEditPrinterConnection({ isCypressAdmin: true })).toBe(true);
    expect(canEditPrinterConnection({ isCypressAdmin: false })).toBe(true);
    expect(canEditPrinterConnection({})).toBe(true);
    expect(canEditPrinterConnection({ isCypressAdmin: true, isRegisterDevice: true })).toBe(false);
    expect(canEditPrinterConnection({ isRegisterDevice: true })).toBe(false);
  });
});

describe('printer-connection: 保存の中身', () => {
  it('お店の setCloudPrntConfig と同じ組み立て：ドロアは空なら今のまま・間隔は 1〜60 に丸める・伝票は知らない値を捨てる', () => {
    expect(cloudPrntConfigPatch({ enabled: false })).toEqual({ ok: true, value: { cloudprnt_enabled: false } });
    expect(cloudPrntConfigPatch({ enabled: true, drawerCommand: '  [drawer: 2] ', pollIntervalSeconds: 90, kitchenStations: ['drink', 'drink', 'bar'] })).toEqual({
      ok: true,
      value: { cloudprnt_enabled: true, drawer_command: '[drawer: 2]', poll_interval_seconds: 60, kitchen_stations: ['drink'] },
    });
    expect(cloudPrntConfigPatch({ enabled: true, drawerCommand: '  ', pollIntervalSeconds: 0 })).toEqual({ ok: true, value: { cloudprnt_enabled: true } });
    expect(cloudPrntConfigPatch({ enabled: true, pollIntervalSeconds: 2.6 })).toEqual({ ok: true, value: { cloudprnt_enabled: true, poll_interval_seconds: 3 } });
    expect(cloudPrntConfigPatch({ enabled: true, kitchenStations: ['bar'] })).toEqual({ ok: false, error: KITCHEN_STATIONS_REQUIRED });
  });

  it('運営の入力：企業・店舗・プリンターの id、使う、間隔 1〜60、ドロア 64 文字まで、伝票 1 つ以上', () => {
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true })).toEqual({ ok: true, value: { ...ref(), enabled: true } });
    const full = parsePrinterConnectionInput({ ...ref(), enabled: true, pollIntervalSeconds: 3, drawerCommand: ' [drawer: 1] ', kitchenStations: ['kitchen', 7] });
    expect(full).toEqual({ ok: true, value: { ...ref(), enabled: true, pollIntervalSeconds: 3, drawerCommand: '[drawer: 1]', kitchenStations: ['kitchen'] } });
    // 空のドロアは今のまま（書かない）
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true, drawerCommand: '  ' })).toEqual({ ok: true, value: { ...ref(), enabled: true } });

    expect(parsePrinterConnectionInput({ ...ref(), organizationId: 'x', enabled: true })).toEqual({ ok: false, error: '店舗が見つかりません' });
    expect(parsePrinterConnectionInput({ ...ref('x'), enabled: true })).toEqual({ ok: false, error: 'プリンターが見つかりません' });
    expect(parsePrinterConnectionInput({ ...ref(), enabled: 'yes' }).ok).toBe(false);
    for (const bad of [0, 61, -1, Number.NaN, '5', Infinity]) {
      expect(parsePrinterConnectionInput({ ...ref(), enabled: true, pollIntervalSeconds: bad }), String(bad)).toEqual({ ok: false, error: '問い合わせ間隔は 1〜60 秒で入れてください' });
    }
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true, drawerCommand: 'x'.repeat(65) }).ok).toBe(false);
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true, drawerCommand: 3 }).ok).toBe(false);
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true, kitchenStations: [] })).toEqual({ ok: false, error: KITCHEN_STATIONS_REQUIRED });
    expect(parsePrinterConnectionInput({ ...ref(), enabled: true, kitchenStations: 'kitchen' })).toEqual({ ok: false, error: KITCHEN_STATIONS_REQUIRED });
    expect(parsePrinterConnectionInput(null).ok).toBe(false);
  });

  it('テスト印刷の入力・運営で直してよい行', () => {
    expect(parsePrinterConnectionTestInput({ ...ref(), kind: 'drawer' })).toEqual({ ok: true, value: { ...ref(), kind: 'drawer' } });
    expect(parsePrinterConnectionTestInput({ ...ref(), kind: 'label' })).toEqual({ ok: false, error: '操作が正しくありません' });

    const row = { organization_id: ORG, store_id: STORE, status: 'active', usage: 'kitchen' };
    const where = { organizationId: ORG, storeId: STORE };
    expect(isConnectionPrinterOf(row, where)).toBe(true);
    expect(isConnectionPrinterOf({ ...row, organization_id: OTHER_ORG }, where)).toBe(false);
    expect(isConnectionPrinterOf({ ...row, store_id: OTHER_STORE }, where)).toBe(false);
    expect(isConnectionPrinterOf({ ...row, status: 'deleted' }, where)).toBe(false);
    expect(isConnectionPrinterOf({ ...row, usage: 'label' }, where)).toBe(false);
    expect(isConnectionPrinterOf(null, where)).toBe(false);
  });
});

// -------------------------------------------------------------
// lib/cloudprnt-test-job.ts
// -------------------------------------------------------------

describe('cloudprnt-test-job', () => {
  const printer = { cloudprnt_enabled: true, paper_width_mm: 58, drawer_command: '[drawer: 2]', usage: 'receipt', drawer_kick: true };
  it('積めないとき（お店の画面と同じ言葉）', () => {
    expect(cloudPrntTestError(null, 'receipt')).toBe('プリンタ設定が見つかりません');
    expect(cloudPrntTestError({ ...printer, cloudprnt_enabled: false }, 'receipt')).toBe('先にCloudPRNTを有効化してください');
    expect(cloudPrntTestError({ ...printer, usage: 'kitchen' }, 'drawer')).toBe('ドロア開放はドロア連動が有効なレシート用プリンタでのみ使えます');
    expect(cloudPrntTestError({ ...printer, drawer_kick: false }, 'drawer')).not.toBeNull();
    expect(cloudPrntTestError({ ...printer, usage: 'kitchen' }, 'receipt')).toBeNull();
  });

  it('Markup・StarPRNT・ePOS-Print XML を積む（ドロアは drawer: true）', async () => {
    const receipt = await cloudPrntTestPayload(printer, 'receipt', '新宿店');
    expect(Object.keys(receipt)).toEqual(['body', 'starprnt', 'epos', 'drawer']);
    expect(receipt.drawer).toBe(false);
    expect(receipt.body).toContain('新宿店');
    expect(Buffer.from(receipt.starprnt, 'base64').length).toBeGreaterThan(0);
    expect(receipt.epos).toContain('epos-print');
    const drawer = await cloudPrntTestPayload(printer, 'drawer', '新宿店');
    expect(drawer.drawer).toBe(true);
    expect(drawer.body).not.toContain('新宿店');
    expect(CLOUDPRNT_TEST_JOB).toEqual({ job_type: 'test', target: 'cloudprnt', content_type: 'text/vnd.star.markup', status: 'queued' });
  });

  it('接続用URLのトークンは推測できない 48 文字（今までと同じ形）', async () => {
    const a = await newCloudPrntToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(await newCloudPrntToken()).not.toBe(a);
  });
});

// -------------------------------------------------------------
// 運営の Server Action
// -------------------------------------------------------------

describe('運営：プリンター接続（app/admin/organizations/printer-connection-actions.ts）', () => {
  it('運営でなければ何も読まず・書かずに止まる', async () => {
    h.state.isAdmin = false;
    await expect(saveAdminPrinterConnection({ ...ref(), enabled: true })).rejects.toThrow('NEXT_REDIRECT /app/dashboard');
    await expect(regenerateAdminPrinterConnectionToken(ref())).rejects.toThrow('NEXT_REDIRECT');
    await expect(enqueueAdminPrinterConnectionTest({ ...ref(), kind: 'receipt' })).rejects.toThrow('NEXT_REDIRECT');
    expect(h.state.calls).toEqual([]);
  });

  it('保存：この企業のこの店舗のプリンターだけ。使う・間隔・ドロアを書き、監査ログに残す', async () => {
    expect(await saveAdminPrinterConnection({ ...ref(), enabled: true, pollIntervalSeconds: 2, drawerCommand: '[drawer: 2]' })).toEqual({});
    const update = writes().find((c) => c.table === 'printer_configs');
    expect(update).toMatchObject({ op: 'update', filters: { id: RECEIPT_P, organization_id: ORG, store_id: STORE } });
    expect(update?.payload).toEqual({ cloudprnt_enabled: true, poll_interval_seconds: 2, drawer_command: '[drawer: 2]', updated_by: 'u-admin' });
    expect(h.state.audits.at(-1)).toMatchObject({
      p_org: ORG,
      p_store: STORE,
      p_action: 'admin.printer_connection.update',
      p_target_table: 'printer_configs',
      p_target_id: RECEIPT_P,
    });
  });

  it('保存：伝票は厨房機だけ（レシート機に来ても書かない）。厨房機で伝票が空なら断る', async () => {
    expect(await saveAdminPrinterConnection({ ...ref(), enabled: true, kitchenStations: ['drink'] })).toEqual({});
    expect(writes().find((c) => c.table === 'printer_configs')?.payload).not.toHaveProperty('kitchen_stations');

    h.state.calls = [];
    expect(await saveAdminPrinterConnection({ ...ref(KITCHEN_P), enabled: true, kitchenStations: ['drink', 'grill', 'drink'] })).toEqual({});
    expect(writes().find((c) => c.table === 'printer_configs')?.payload).toMatchObject({ kitchen_stations: ['drink', 'grill'] });

    h.state.calls = [];
    expect(await saveAdminPrinterConnection({ ...ref(KITCHEN_P), enabled: true, kitchenStations: ['bar'] })).toEqual({ error: KITCHEN_STATIONS_REQUIRED });
    expect(writes()).toEqual([]);
  });

  it('保存：ほかの企業の店舗・ほかの店のプリンター・ラベル機・削除済み・おかしな入力は断る（何も書かない）', async () => {
    expect(await saveAdminPrinterConnection({ ...ref(), storeId: OTHER_STORE, enabled: true })).toEqual({ error: '店舗が見つかりません' });
    expect(await saveAdminPrinterConnection({ ...ref(), organizationId: OTHER_ORG, enabled: true })).toEqual({ error: '店舗が見つかりません' });
    expect(await saveAdminPrinterConnection({ ...ref(LABEL_P), enabled: true })).toEqual({ error: 'プリンターが見つかりません' });
    world({ printer_configs: () => ({ data: { ...printers[RECEIPT_P], store_id: OTHER_STORE }, error: null }) });
    expect(await saveAdminPrinterConnection({ ...ref(), enabled: true })).toEqual({ error: 'プリンターが見つかりません' });
    world({ printer_configs: () => ({ data: { ...printers[RECEIPT_P], status: 'deleted' }, error: null }) });
    expect(await saveAdminPrinterConnection({ ...ref(), enabled: true })).toEqual({ error: 'プリンターが見つかりません' });
    expect(writes()).toEqual([]);

    h.state.calls = [];
    expect(await saveAdminPrinterConnection({ ...ref(), enabled: true, pollIntervalSeconds: 120 })).toEqual({ error: '問い合わせ間隔は 1〜60 秒で入れてください' });
    expect(h.state.calls).toEqual([]);
  });

  it('URLを再発行：新しいトークンを書き、監査ログにはトークンを残さない', async () => {
    expect(await regenerateAdminPrinterConnectionToken(ref())).toEqual({});
    const update = writes().find((c) => c.table === 'printer_configs');
    expect(update).toMatchObject({ op: 'update', filters: { id: RECEIPT_P, organization_id: ORG, store_id: STORE } });
    expect(update?.payload?.cloudprnt_token).toMatch(/^[0-9a-f]{48}$/);
    expect(update?.payload?.updated_by).toBe('u-admin');
    const audit = h.state.audits.at(-1);
    expect(audit).toMatchObject({ p_action: 'admin.printer_connection.token_regenerate', p_target_id: RECEIPT_P });
    expect(JSON.stringify(audit)).not.toContain(update?.payload?.cloudprnt_token as string);

    h.state.calls = [];
    expect(await regenerateAdminPrinterConnectionToken(ref(RECEIPT_P, { storeId: OTHER_STORE }))).toEqual({ error: '店舗が見つかりません' });
    expect(await regenerateAdminPrinterConnectionToken(ref(LABEL_P))).toEqual({ error: 'プリンターが見つかりません' });
    expect(writes()).toEqual([]);
  });

  it('テスト印刷：お店の「テスト印刷」と同じジョブを積む（同じ列・同じ中身）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(), kind: 'receipt' })).toEqual({});
    const adminJob = writes().find((c) => c.table === 'print_jobs');
    expect(adminJob?.op).toBe('insert');
    expect(adminJob?.payload).toMatchObject({
      organization_id: ORG,
      store_id: STORE,
      printer_config_id: RECEIPT_P,
      job_type: 'test',
      target: 'cloudprnt',
      content_type: 'text/vnd.star.markup',
      status: 'queued',
      created_by: 'u-admin',
    });
    expect(h.state.audits.at(-1)).toMatchObject({ p_action: 'admin.printer_connection.test', p_after: { name: 'レジ', kind: 'receipt' } });

    // お店の画面から同じプリンターに積んだジョブと、作り手以外は同じ
    h.state.calls = [];
    expect(await enqueueCloudPrntTest(RECEIPT_P, STORE, 'receipt')).toEqual({});
    const storeJob = writes().find((c) => c.table === 'print_jobs');
    expect({ ...adminJob?.payload, created_by: null }).toEqual({ ...storeJob?.payload, created_by: null });
  });

  it('テスト印刷：「使う」が OFF・厨房機のドロア・ほかの店のプリンターは断る', async () => {
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(OFF_P), kind: 'receipt' })).toEqual({ error: '先にCloudPRNTを有効化してください' });
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(KITCHEN_P), kind: 'drawer' })).toEqual({
      error: 'ドロア開放はドロア連動が有効なレシート用プリンタでのみ使えます',
    });
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(RECEIPT_P, { storeId: OTHER_STORE }), kind: 'receipt' })).toEqual({ error: '店舗が見つかりません' });
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(), kind: 'eject' })).toEqual({ error: '操作が正しくありません' });
    expect(writes()).toEqual([]);
    // ドロア連動のレシート機なら積める
    expect(await enqueueAdminPrinterConnectionTest({ ...ref(), kind: 'drawer' })).toEqual({});
    expect(writes().find((c) => c.table === 'print_jobs')?.payload).toMatchObject({ payload: { drawer: true } });
  });

  it('どの Server Action も最初に requireCypressAdmin を通す', () => {
    const src = readFileSync(join(__dirname, '..', 'app/admin/organizations/printer-connection-actions.ts'), 'utf8');
    const names = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(names).toEqual(['saveAdminPrinterConnection', 'regenerateAdminPrinterConnectionToken', 'enqueueAdminPrinterConnectionTest']);
    for (const name of names) {
      const body = src.slice(src.indexOf(`export async function ${name}(`));
      const firstStatement = body.slice(body.indexOf('{\n') + 1).trim().split('\n')[0];
      expect(firstStatement, name).toBe('const ctx = await requireCypressAdmin();');
    }
  });
});

// -------------------------------------------------------------
// お店の管理画面：見るだけ（テスト印刷・ドロアを開くは使える）
// -------------------------------------------------------------

describe('お店の管理画面：プリンター接続は見るだけ', () => {
  it('お店の管理者は 使う・間隔・ドロア・伝票・URL再発行 を変えられる（いまは ON。断る言葉は出ない）', async () => {
    expect(await setCloudPrntConfig({ id: RECEIPT_P, storeId: STORE, enabled: false })).not.toEqual({ error: PRINTER_CONNECTION_ADMIN_NOTE });
    expect(await setCloudPrntConfig({ id: KITCHEN_P, storeId: STORE, enabled: true, pollIntervalSeconds: 3, kitchenStations: ['drink'] })).not.toEqual({
      error: PRINTER_CONNECTION_ADMIN_NOTE,
    });
    expect(await regenerateCloudPrntToken(RECEIPT_P, STORE)).not.toEqual({ error: PRINTER_CONNECTION_ADMIN_NOTE });
  });

  it('レジ端末（iPad）は今まで通りの言葉で断る', async () => {
    h.state.storeCtx = { ...h.state.storeCtx, isRegisterDevice: true, isCypressAdmin: true };
    expect(await setCloudPrntConfig({ id: RECEIPT_P, storeId: STORE, enabled: true })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await regenerateCloudPrntToken(RECEIPT_P, STORE)).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(h.state.calls).toEqual([]);
  });

  it('運営のアカウントなら、お店の画面からも今まで通り保存できる（中身は運営と同じ組み立て）', async () => {
    h.state.storeCtx = { ...h.state.storeCtx, isCypressAdmin: true };
    expect(await setCloudPrntConfig({ id: KITCHEN_P, storeId: STORE, enabled: true, drawerCommand: '[drawer: 1]', pollIntervalSeconds: 75, kitchenStations: ['drink'] })).toEqual({});
    expect(writes().find((c) => c.table === 'printer_configs')).toMatchObject({
      op: 'update',
      filters: { id: KITCHEN_P, organization_id: ORG, store_id: STORE },
      payload: { cloudprnt_enabled: true, drawer_command: '[drawer: 1]', poll_interval_seconds: 60, kitchen_stations: ['drink'], updated_by: 'u-store' },
    });
    expect(await setCloudPrntConfig({ id: KITCHEN_P, storeId: STORE, enabled: true, kitchenStations: [] })).toEqual({ error: KITCHEN_STATIONS_REQUIRED });
    h.state.calls = [];
    expect(await regenerateCloudPrntToken(RECEIPT_P, STORE)).toEqual({});
    expect(writes()[0]?.payload?.cloudprnt_token).toMatch(/^[0-9a-f]{48}$/);
  });

  it('テスト印刷・ドロアを開くは、運営でないお店のスタッフも使える（今まで通りの確かめ方）', async () => {
    expect(await enqueueCloudPrntTest(RECEIPT_P, STORE, 'drawer')).toEqual({});
    expect(writes().find((c) => c.table === 'print_jobs')?.payload).toMatchObject({
      organization_id: ORG,
      store_id: STORE,
      printer_config_id: RECEIPT_P,
      target: 'cloudprnt',
      created_by: 'u-store',
      payload: { drawer: true },
    });
    h.state.calls = [];
    expect(await enqueueCloudPrntTest(OFF_P, STORE, 'receipt')).toEqual({ error: '先にCloudPRNTを有効化してください' });
    expect(await enqueueCloudPrntTest(KITCHEN_P, STORE, 'drawer')).toEqual({ error: 'ドロア開放はドロア連動が有効なレシート用プリンタでのみ使えます' });
    expect(await enqueueCloudPrntTest(RECEIPT_P, OTHER_STORE, 'receipt')).toEqual({ error: '対象店舗にアクセス権がありません' });
    expect(writes()).toEqual([]);
  });

  it('お店のアカウントには接続用URLのトークンを渡さない・画面は見るだけの表示', () => {
    const page = readFileSync(join(__dirname, '..', 'app/app/settings/printers/page.tsx'), 'utf8');
    expect(page).toContain('canEditConnection ? p : { ...p, cloudprntToken: null }');
    expect(page).toContain('canEdit={canEditConnection}');
    const panel = readFileSync(join(__dirname, '..', 'components/settings/cloudprnt-panel.tsx'), 'utf8');
    const readOnly = panel.slice(panel.indexOf('function ReadOnlyPrinterRow('), panel.indexOf('function EpsonSetupGuide('));
    expect(readOnly).toContain('enqueueCloudPrntTest');
    for (const editOnly of ['setCloudPrntConfig', 'regenerateCloudPrntToken', 'printerConnectionUrl', '<Input', 'URLを再発行', '保存']) {
      expect(readOnly, editOnly).not.toContain(editOnly);
    }
  });
});
