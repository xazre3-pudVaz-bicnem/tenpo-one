import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * LAN・Wi-Fi のプリンターは運営（コントロールセンター /admin）で決める（2026-10-25 Ronnie）。
 *   - lib/network-printers.ts の入力チェック・候補・設定の書き戻し
 *   - 運営の Server Action（app/admin/organizations/printer-actions.ts）：運営だけ・その企業のその店舗のものだけ
 *   - お店の管理画面（/app/settings/devices・/app/settings/printers）からは LAN・Wi-Fi を変えられない
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
      not: self,
      or: self,
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
  assertStoreAccess: (ctx: { isHq: boolean; stores: { id: string }[] }, storeId: string) => {
    if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) throw new Error('この店舗の操作はできません');
  },
}));

import {
  describeNetworkPrinterIds,
  isManagedNetworkPrinter,
  keepKnownPrinterIds,
  keepNetworkPrinters,
  NETWORK_PRINTER_ADMIN_NOTE,
  networkPrinterCandidates,
  parseDeviceNetworkPrintersInput,
  parseNetworkPrinterInput,
  parseNetworkPrinterRef,
  printerConfigColumns,
  printerConfigError,
  withNetworkPrinters,
  withoutNetworkPrinter,
  type NetworkPrinterRow,
} from '@/lib/network-printers';
import { EMPTY_DEVICE_SETTING } from '@/lib/device-settings';
import { deleteAdminNetworkPrinter, saveAdminDeviceNetworkPrinters, saveAdminNetworkPrinter } from '@/app/admin/organizations/printer-actions';
import { saveRegisterDeviceSetting } from '@/app/app/settings/devices/actions';
import { deletePrinterConfig, savePrinterConfig } from '@/app/app/settings/printers/actions';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const STORE = '00000000-0000-4000-8000-0000000000b1';
const OTHER_STORE = '00000000-0000-4000-8000-0000000000b2';
const DEVICE = '00000000-0000-4000-8000-0000000000c1';
const DEVICE2 = '00000000-0000-4000-8000-0000000000c2';
const LAN_P = '00000000-0000-4000-8000-0000000000d1'; // SII RP-F10・有線LAN（LAN で送る）
const EPSON_P = '00000000-0000-4000-8000-0000000000d2'; // EPSON・Wi-Fi（LAN で送る・Wi-Fi で直接印刷の両方）
const STAR_P = '00000000-0000-4000-8000-0000000000d3'; // Star・CloudPRNT（iPad の候補にならない）
const OFF_P = '00000000-0000-4000-8000-0000000000d4'; // 「使う」が OFF
const FLOOR = '00000000-0000-4000-8000-0000000000e1';
const FLOOR_OTHER = '00000000-0000-4000-8000-0000000000e2';

const printerRows: NetworkPrinterRow[] = [
  { id: LAN_P, name: '厨房 RP-F10', maker: 'SII', usage: 'kitchen', connection_type: 'lan', ip_address: '192.168.1.50', cloudprnt_enabled: true },
  { id: EPSON_P, name: 'レジ横 EPSON', maker: 'EPSON', usage: 'receipt', connection_type: 'wifi', ip_address: '192.168.1.60', cloudprnt_enabled: true },
  { id: STAR_P, name: 'ドリンク Star', maker: 'Star', usage: 'kitchen', connection_type: 'lan', ip_address: '192.168.1.70', cloudprnt_enabled: true },
  { id: OFF_P, name: '止めている EPSON', maker: 'EPSON', usage: 'kitchen', connection_type: 'lan', ip_address: '192.168.1.80', cloudprnt_enabled: false },
];

const validPrinter = (over: Row = {}) => ({
  organizationId: ORG,
  storeId: STORE,
  name: ' 厨房 RP-F10 ',
  maker: 'SII',
  model: 'RP-F10',
  connectionType: 'lan',
  ipAddress: '192.168.1.50',
  usage: 'kitchen',
  paperWidthMm: 80,
  autoPrint: false,
  drawerKick: false,
  billSlips: true,
  upsideDown: true,
  floorIds: [FLOOR, 'x', FLOOR],
  enabled: true,
  ...over,
});

beforeEach(() => {
  h.state.isAdmin = true;
  h.state.calls = [];
  h.state.audits = [];
  h.state.respond = () => ({ data: null, error: null });
  h.state.storeCtx = { userId: 'u-store', organizationId: ORG, role: 'store_manager', isHq: false, isRegisterDevice: false, stores: [{ id: STORE }] };
});

const writes = () => h.state.calls.filter((c) => c.op !== 'select');

// -------------------------------------------------------------
// lib/network-printers.ts（純粋な関数）
// -------------------------------------------------------------

describe('network-printers: プリンターの入力', () => {
  it('運営の追加・編集：形を確かめて整える', () => {
    const r = parseNetworkPrinterInput(validPrinter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ id: null, name: '厨房 RP-F10', connectionType: 'lan', usage: 'kitchen', billSlips: true, enabled: true, floorIds: [FLOOR] });
    // 用途が厨房以外なら会計伝票は false、ラベル機は担当フロアなし
    const label = parseNetworkPrinterInput(validPrinter({ usage: 'label', maker: 'EPSON' }));
    expect(label.ok && label.value.billSlips).toBe(false);
    expect(label.ok && label.value.floorIds).toEqual([]);
  });

  it('LAN・Wi-Fi 以外・用途・用紙幅・id・店舗がおかしければ断る', () => {
    expect(parseNetworkPrinterInput(validPrinter({ connectionType: 'bluetooth' }))).toEqual({ ok: false, error: '接続方式は「有線LAN」か「Wi-Fi」を選んでください' });
    expect(parseNetworkPrinterInput(validPrinter({ usage: 'drink' })).ok).toBe(false);
    expect(parseNetworkPrinterInput(validPrinter({ paperWidthMm: 70 })).ok).toBe(false);
    expect(parseNetworkPrinterInput(validPrinter({ id: 'abc' }))).toEqual({ ok: false, error: 'プリンターが見つかりません' });
    expect(parseNetworkPrinterInput(validPrinter({ storeId: 'x' }))).toEqual({ ok: false, error: '店舗が見つかりません' });
    expect(parseNetworkPrinterInput(null).ok).toBe(false);
  });

  it('お店の管理画面と同じチェック：名前・SII は IP が要る', () => {
    expect(parseNetworkPrinterInput(validPrinter({ name: '  ' }))).toEqual({ ok: false, error: 'プリンター名を入力してください' });
    expect(parseNetworkPrinterInput(validPrinter({ ipAddress: '8.8.8.8' })).ok).toBe(false);
    // Star（CloudPRNT）は IP なしでよい
    expect(parseNetworkPrinterInput(validPrinter({ maker: 'Star', ipAddress: '' })).ok).toBe(true);
    expect(printerConfigError({ name: 'a', maker: 'SII', connectionType: 'bluetooth', ipAddress: '' })).toBeNull();
  });

  it('printer_configs に書く列（お店の管理画面と同じ）', () => {
    const cols = printerConfigColumns(
      { name: ' A ', maker: ' ', model: '', connectionType: '', ipAddress: ' 192.168.1.5 ', usage: 'receipt', paperWidthMm: 58, autoPrint: true, drawerKick: true, billSlips: true },
      [FLOOR]
    );
    expect(cols).toEqual({
      name: 'A',
      maker: null,
      model: null,
      connection_type: null,
      ip_address: '192.168.1.5',
      usage: 'receipt',
      paper_width_mm: 58,
      auto_print: true,
      drawer_kick: true,
      floor_ids: [FLOOR],
      bill_slips: false,
      upside_down: false,
    });
  });

  it('プリンター 1 台を指す入力', () => {
    expect(parseNetworkPrinterRef({ organizationId: ORG, storeId: STORE, printerId: LAN_P }).ok).toBe(true);
    expect(parseNetworkPrinterRef({ organizationId: ORG, storeId: STORE, printerId: 'x' }).ok).toBe(false);
  });

  it('運営で直してよい行：この企業・この店舗・使っている・LAN / Wi-Fi だけ', () => {
    const row = { organization_id: ORG, store_id: STORE, status: 'active', connection_type: 'wifi' };
    const ref = { organizationId: ORG, storeId: STORE };
    expect(isManagedNetworkPrinter(row, ref)).toBe(true);
    expect(isManagedNetworkPrinter({ ...row, organization_id: OTHER_ORG }, ref)).toBe(false);
    expect(isManagedNetworkPrinter({ ...row, store_id: OTHER_STORE }, ref)).toBe(false);
    expect(isManagedNetworkPrinter({ ...row, status: 'deleted' }, ref)).toBe(false);
    expect(isManagedNetworkPrinter({ ...row, connection_type: 'bluetooth' }, ref)).toBe(false);
    expect(isManagedNetworkPrinter(null, ref)).toBe(false);
  });
});

describe('network-printers: iPad ごとの割り当て', () => {
  it('null は端末まかせ・[] は送らない・重複と UUID 以外は捨てる・8 台を超えたら断る', () => {
    const base = { organizationId: ORG, storeId: STORE, deviceId: DEVICE };
    expect(parseDeviceNetworkPrintersInput({ ...base, lanPrinterIds: null })).toEqual({ ok: true, value: { ...base, lanPrinterIds: null, wifiPrinterIds: null } });
    const r = parseDeviceNetworkPrintersInput({ ...base, lanPrinterIds: [LAN_P, LAN_P, 'x'], wifiPrinterIds: [] });
    expect(r.ok && r.value.lanPrinterIds).toEqual([LAN_P]);
    expect(r.ok && r.value.wifiPrinterIds).toEqual([]);
    const nine = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`);
    expect(parseDeviceNetworkPrintersInput({ ...base, lanPrinterIds: nine })).toEqual({ ok: false, error: 'LAN のプリンターは 8 台までです' });
    expect(parseDeviceNetworkPrintersInput({ ...base, wifiPrinterIds: 'x' }).ok).toBe(false);
    expect(parseDeviceNetworkPrintersInput({ ...base, deviceId: 'x' })).toEqual({ ok: false, error: '端末が見つかりません' });
  });

  it('候補：「使う」の LAN 中継（Star 以外）と EPSON の Wi-Fi 直接印刷', () => {
    const { lan, wifi } = networkPrinterCandidates(printerRows);
    expect(lan.map((p) => p.id)).toEqual([LAN_P, EPSON_P]);
    expect(wifi.map((p) => p.id)).toEqual([EPSON_P]);
    expect(lan[0].detail).toBe('厨房・有線LAN・192.168.1.50');
    expect(keepKnownPrinterIds([LAN_P, STAR_P], new Set([LAN_P]))).toEqual([LAN_P]);
    expect(keepKnownPrinterIds(null, new Set([LAN_P]))).toBeNull();
  });

  it('お店の保存は LAN・Wi-Fi を今の値のまま、運営の保存は LAN・Wi-Fi だけ変える', () => {
    const current = { ...EMPTY_DEVICE_SETTING, label: '入口', printerConfigId: EPSON_P, lanPrinterIds: [LAN_P], wifiPrinterIds: [] };
    expect(keepNetworkPrinters({ label: '2階', printerConfigId: null, nativePos: null }, current)).toEqual({
      label: '2階',
      printerConfigId: null,
      nativePos: null,
      lanPrinterIds: [LAN_P],
      wifiPrinterIds: [],
    });
    expect(keepNetworkPrinters({ label: null, printerConfigId: null, nativePos: null }, undefined)).toEqual(EMPTY_DEVICE_SETTING);
    expect(withNetworkPrinters(current, null, [EPSON_P])).toEqual({ ...current, lanPrinterIds: null, wifiPrinterIds: [EPSON_P] });
    expect(withNetworkPrinters(undefined, [LAN_P], null)).toEqual({ ...EMPTY_DEVICE_SETTING, lanPrinterIds: [LAN_P] });
  });

  it('プリンターを消したら、どの iPad の一覧からも外す（ほかの設定はそのまま）', () => {
    const settings = {
      drawer: { autoOpenOnCash: true },
      devices: {
        [DEVICE]: { label: '入口', lanPrinterIds: [LAN_P, EPSON_P], wifiPrinterIds: [EPSON_P] },
        [DEVICE2]: { lanPrinterIds: [LAN_P] },
      },
    };
    const r = withoutNetworkPrinter(settings, EPSON_P);
    expect(r.changed).toBe(true);
    expect(r.settings.drawer).toEqual({ autoOpenOnCash: true });
    const devices = r.settings.devices as Record<string, Row>;
    expect(devices[DEVICE]).toMatchObject({ label: '入口', lanPrinterIds: [LAN_P], wifiPrinterIds: [] });
    expect(devices[DEVICE2]).toMatchObject({ lanPrinterIds: [LAN_P] });
    expect(withoutNetworkPrinter(settings, STAR_P)).toEqual({ settings, changed: false });
  });

  it('お店の管理画面で見せる文字', () => {
    const { lan } = networkPrinterCandidates(printerRows);
    expect(describeNetworkPrinterIds(null, lan)).toBe('端末まかせ（今までどおり）');
    expect(describeNetworkPrinterIds([], lan)).toBe('送らない');
    expect(describeNetworkPrinterIds([LAN_P], lan)).toBe('厨房 RP-F10');
    expect(describeNetworkPrinterIds([LAN_P, STAR_P], lan)).toBe('厨房 RP-F10（ほか今は使えないプリンター 1台）');
    expect(describeNetworkPrinterIds([STAR_P], lan)).toBe('今は使えないプリンター 1台');
  });
});

// -------------------------------------------------------------
// 運営の Server Action
// -------------------------------------------------------------

/** DB の返事（企業 ORG の店舗 STORE・端末 DEVICE・プリンター printerRows） */
function world(over: Partial<Record<string, (c: Call) => Res>> = {}, settings: Row = {}) {
  h.state.respond = (c: Call) => {
    const f = over[c.table];
    if (f) return f(c);
    if (c.op !== 'select') return { data: c.op === 'insert' ? { id: '00000000-0000-4000-8000-0000000000f1' } : null, error: null };
    if (c.table === 'stores') {
      return { data: c.filters.id === STORE ? { id: STORE, organization_id: ORG } : c.filters.id === OTHER_STORE ? { id: OTHER_STORE, organization_id: OTHER_ORG } : null, error: null };
    }
    if (c.table === 'register_devices') {
      return { data: c.filters.id === DEVICE ? { id: DEVICE, organization_id: ORG, store_id: STORE, status: 'active' } : null, error: null };
    }
    if (c.table === 'printer_configs') {
      if (c.filters.id) {
        const p = printerRows.find((r) => r.id === c.filters.id);
        return { data: p ? { ...p, organization_id: ORG, store_id: STORE, status: 'active' } : null, error: null };
      }
      return { data: printerRows, error: null };
    }
    if (c.table === 'floors') return { data: [{ id: FLOOR }], error: null };
    if (c.table === 'store_settings') return { data: { settings }, error: null };
    return { data: null, error: null };
  };
}

describe('運営：LAN・Wi-Fi のプリンター（app/admin/organizations/printer-actions.ts）', () => {
  it('運営でなければ何も読まず・書かずに止まる', async () => {
    h.state.isAdmin = false;
    world();
    await expect(saveAdminNetworkPrinter(validPrinter())).rejects.toThrow('NEXT_REDIRECT /app/dashboard');
    await expect(deleteAdminNetworkPrinter({ organizationId: ORG, storeId: STORE, printerId: LAN_P })).rejects.toThrow('NEXT_REDIRECT');
    await expect(saveAdminDeviceNetworkPrinters({ organizationId: ORG, storeId: STORE, deviceId: DEVICE, lanPrinterIds: [LAN_P] })).rejects.toThrow('NEXT_REDIRECT');
    expect(h.state.calls).toEqual([]);
  });

  it('追加：この企業の店舗だけ。担当フロアはこの店のフロアだけ・「使う」も書く', async () => {
    world();
    expect(await saveAdminNetworkPrinter(validPrinter({ floorIds: [FLOOR, FLOOR_OTHER] }))).toEqual({});
    const insert = writes().find((c) => c.table === 'printer_configs');
    expect(insert?.op).toBe('insert');
    expect(insert?.payload).toMatchObject({
      organization_id: ORG,
      store_id: STORE,
      name: '厨房 RP-F10',
      connection_type: 'lan',
      ip_address: '192.168.1.50',
      floor_ids: [FLOOR],
      cloudprnt_enabled: true,
      created_by: 'u-admin',
      updated_by: 'u-admin',
    });
    expect(h.state.audits.at(-1)).toMatchObject({ p_org: ORG, p_store: STORE, p_action: 'admin.network_printer.add' });

    // ほかの企業の店舗を指したら断る
    h.state.calls = [];
    expect(await saveAdminNetworkPrinter(validPrinter({ storeId: OTHER_STORE }))).toEqual({ error: '店舗が見つかりません' });
    expect(writes()).toEqual([]);
  });

  it('編集：ほかの企業・ほかの店舗・LAN / Wi-Fi でない行は断る', async () => {
    world({
      printer_configs: (c) => ({ data: c.op === 'select' ? { id: LAN_P, organization_id: OTHER_ORG, store_id: STORE, status: 'active', connection_type: 'lan' } : null, error: null }),
    });
    expect(await saveAdminNetworkPrinter(validPrinter({ id: LAN_P }))).toEqual({ error: 'プリンターが見つかりません' });
    world({
      printer_configs: (c) => ({ data: c.op === 'select' ? { id: LAN_P, organization_id: ORG, store_id: STORE, status: 'active', connection_type: 'bluetooth' } : null, error: null }),
    });
    expect(await saveAdminNetworkPrinter(validPrinter({ id: LAN_P }))).toEqual({ error: 'プリンターが見つかりません' });
    expect(writes()).toEqual([]);

    world();
    expect(await saveAdminNetworkPrinter(validPrinter({ id: LAN_P, enabled: false }))).toEqual({});
    const update = writes().find((c) => c.table === 'printer_configs');
    expect(update).toMatchObject({ op: 'update', filters: { id: LAN_P, organization_id: ORG, store_id: STORE } });
    expect(update?.payload).toMatchObject({ cloudprnt_enabled: false });
  });

  it('削除：論理削除して、iPad の LAN・Wi-Fi の一覧からも外す', async () => {
    world({}, { devices: { [DEVICE]: { label: '入口', lanPrinterIds: [LAN_P, EPSON_P], wifiPrinterIds: null } } });
    expect(await deleteAdminNetworkPrinter({ organizationId: ORG, storeId: STORE, printerId: LAN_P })).toEqual({});
    const del = writes().find((c) => c.table === 'printer_configs');
    expect(del).toMatchObject({ op: 'update', payload: { status: 'deleted' }, filters: { id: LAN_P, organization_id: ORG, store_id: STORE } });
    const settings = writes().find((c) => c.table === 'store_settings');
    expect((settings?.payload?.settings as { devices: Record<string, Row> }).devices[DEVICE]).toMatchObject({ label: '入口', lanPrinterIds: [EPSON_P], wifiPrinterIds: null });

    // ほかの企業のプリンターは消さない
    h.state.calls = [];
    world({ printer_configs: () => ({ data: { id: LAN_P, organization_id: OTHER_ORG, store_id: STORE, status: 'active', connection_type: 'lan' }, error: null }) });
    expect(await deleteAdminNetworkPrinter({ organizationId: ORG, storeId: STORE, printerId: LAN_P })).toEqual({ error: 'プリンターが見つかりません' });
    expect(writes()).toEqual([]);
  });

  it('iPad ごと：この店の端末だけ。候補でない id は捨て、表示名・レシートの出し先はそのまま', async () => {
    world({}, { registerReport: { lunchUntil: '15:00' }, devices: { [DEVICE]: { label: '入口', printerConfigId: EPSON_P, lanPrinterIds: null } } });
    const res = await saveAdminDeviceNetworkPrinters({
      organizationId: ORG,
      storeId: STORE,
      deviceId: DEVICE,
      lanPrinterIds: [LAN_P, STAR_P, OFF_P],
      wifiPrinterIds: [EPSON_P, LAN_P],
    });
    expect(res).toEqual({ lanPrinterIds: [LAN_P], wifiPrinterIds: [EPSON_P] });
    const upsert = writes().find((c) => c.table === 'store_settings');
    expect(upsert?.op).toBe('upsert');
    expect(upsert?.payload).toMatchObject({ organization_id: ORG, store_id: STORE, updated_by: 'u-admin' });
    const settings = upsert?.payload?.settings as { registerReport: Row; devices: Record<string, Row> };
    expect(settings.registerReport).toEqual({ lunchUntil: '15:00' });
    expect(settings.devices[DEVICE]).toEqual({ ...EMPTY_DEVICE_SETTING, label: '入口', printerConfigId: EPSON_P, lanPrinterIds: [LAN_P], wifiPrinterIds: [EPSON_P] });
    expect(h.state.audits.at(-1)).toMatchObject({ p_action: 'admin.register_device.network_printers', p_target_id: DEVICE });
  });

  it('iPad ごと：ほかの店の端末・ほかの企業・解除済みは断る', async () => {
    world({ register_devices: () => ({ data: { id: DEVICE2, organization_id: ORG, store_id: OTHER_STORE, status: 'active' }, error: null }) });
    expect(await saveAdminDeviceNetworkPrinters({ organizationId: ORG, storeId: STORE, deviceId: DEVICE2, lanPrinterIds: [LAN_P] })).toEqual({ error: '端末が見つかりません' });
    world({ register_devices: () => ({ data: { id: DEVICE, organization_id: ORG, store_id: STORE, status: 'revoked' }, error: null }) });
    expect(await saveAdminDeviceNetworkPrinters({ organizationId: ORG, storeId: STORE, deviceId: DEVICE, lanPrinterIds: [LAN_P] })).toEqual({ error: '登録を解除した端末です' });
    world();
    expect(await saveAdminDeviceNetworkPrinters({ organizationId: OTHER_ORG, storeId: STORE, deviceId: DEVICE, lanPrinterIds: [LAN_P] })).toEqual({ error: '店舗が見つかりません' });
    expect(writes()).toEqual([]);
  });

  it('どの Server Action も最初に requireCypressAdmin を通す', () => {
    const src = readFileSync(join(__dirname, '..', 'app/admin/organizations/printer-actions.ts'), 'utf8');
    const names = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(names).toEqual(['saveAdminNetworkPrinter', 'deleteAdminNetworkPrinter', 'saveAdminDeviceNetworkPrinters']);
    for (const name of names) {
      const body = src.slice(src.indexOf(`export async function ${name}(`));
      const firstStatement = body.slice(body.indexOf('{\n') + 1).trim().split('\n')[0];
      expect(firstStatement, name).toBe('const ctx = await requireCypressAdmin();');
    }
  });
});

// -------------------------------------------------------------
// お店の管理画面からは LAN・Wi-Fi を変えない
// -------------------------------------------------------------

describe('お店の管理画面：LAN・Wi-Fi は見るだけ', () => {
  it('設定 › レジ端末の保存は lanPrinterIds / wifiPrinterIds を書かない（今の値を残す）', async () => {
    world({}, { devices: { [DEVICE]: { label: '入口', lanPrinterIds: [LAN_P], wifiPrinterIds: [] } } });
    const res = await saveRegisterDeviceSetting({
      storeId: STORE,
      deviceId: DEVICE,
      label: '2階レジ',
      printerConfigId: '',
      nativePos: 'device',
      // 古い画面・作った POST が送ってきても無視する
      ...({ lanPrinterIds: [EPSON_P], wifiPrinterIds: [EPSON_P] } as Row),
    } as Parameters<typeof saveRegisterDeviceSetting>[0]);
    expect(res).toEqual({ ok: true, setting: { ...EMPTY_DEVICE_SETTING, label: '2階レジ', lanPrinterIds: [LAN_P], wifiPrinterIds: [] } });
    const upsert = writes().find((c) => c.table === 'store_settings');
    expect((upsert?.payload?.settings as { devices: Record<string, Row> }).devices[DEVICE]).toEqual({
      ...EMPTY_DEVICE_SETTING,
      label: '2階レジ',
      lanPrinterIds: [LAN_P],
      wifiPrinterIds: [],
    });
    // printer_configs を LAN・Wi-Fi のために読みに行かない
    expect(h.state.calls.some((c) => c.table === 'printer_configs')).toBe(false);
  });

  it('端末まかせ（null）のままなら null のまま', async () => {
    world({}, {});
    const res = await saveRegisterDeviceSetting({ storeId: STORE, deviceId: DEVICE, label: '入口', printerConfigId: '', nativePos: 'device' });
    expect(res.ok && res.setting.lanPrinterIds).toBeNull();
    expect(res.ok && res.setting.wifiPrinterIds).toBeNull();
  });

  it('設定 › レジ・プリンター：有線LAN・Wi-Fi のプリンターは追加・変更・削除できない', async () => {
    world({ printer_configs: (c) => ({ data: c.op === 'select' ? { id: LAN_P, connection_type: 'lan' } : null, error: null }) });
    const base = {
      storeId: STORE,
      name: 'ドリンク',
      maker: 'EPSON',
      model: '',
      ipAddress: '192.168.1.90',
      usage: 'kitchen',
      paperWidthMm: 80,
      autoPrint: false,
      drawerKick: false,
    };
    expect(await savePrinterConfig({ ...base, connectionType: 'wifi' })).toEqual({ error: NETWORK_PRINTER_ADMIN_NOTE });
    expect(await savePrinterConfig({ ...base, connectionType: 'lan' })).toEqual({ error: NETWORK_PRINTER_ADMIN_NOTE });
    // 今 LAN の行を Bluetooth に付け替えるのも運営で
    expect(await savePrinterConfig({ ...base, id: LAN_P, connectionType: 'bluetooth' })).toEqual({ error: NETWORK_PRINTER_ADMIN_NOTE });
    expect(await deletePrinterConfig(LAN_P, STORE)).toEqual({ error: NETWORK_PRINTER_ADMIN_NOTE });
    expect(writes()).toEqual([]);

    // Bluetooth のプリンターは今まで通り
    world({ printer_configs: (c) => ({ data: c.op === 'select' ? { id: LAN_P, connection_type: 'bluetooth' } : null, error: null }) });
    expect(await savePrinterConfig({ ...base, id: LAN_P, connectionType: 'bluetooth', usage: 'receipt' })).toEqual({});
    expect(writes().find((c) => c.table === 'printer_configs')).toMatchObject({ op: 'update', payload: { connection_type: 'bluetooth', name: 'ドリンク' } });
    expect(await deletePrinterConfig(LAN_P, STORE)).toEqual({});
  });
});
