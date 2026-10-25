/**
 * LAN・Wi-Fi のプリンター（printer_configs.connection_type が lan / wifi の行）と、
 * iPad ごとの「LAN のプリンターへ、この iPad から送る」「Wi-Fi で直接印刷」
 * （store_settings.settings.devices[register_devices.id].lanPrinterIds / wifiPrinterIds。lib/device-settings.ts）。
 *
 * 2026-10-25 Ronnie「printer の LAN・Wi-Fi の設定は 店舗管理画面 からではなく control centre（運営コンソール /admin）から」。
 *   - 運営（CYPRESS / D&DREAM）… プリンターの追加・編集・削除、iPad ごとの割り当て（app/admin/organizations/printer-actions.ts）
 *   - お店の管理画面 … 見るだけ（/app/settings/printers・/app/settings/devices）。Bluetooth・USB・レシートの出し先は今まで通り
 * DB の列は増やさない（移行なし）。純粋な関数だけ（tests/network-printers.test.ts）。
 */

import { isEpsonMaker, isLanRelayPrinter, isLocalPrinterHost, parseLanTarget, printerDeliveryOf } from '@/lib/direct-print';
import { deviceSettingsFrom, EMPTY_DEVICE_SETTING, withDeviceSetting, type DeviceSetting } from '@/lib/device-settings';
import { normalizeFloorIds } from '@/lib/printer-floors';

/** お店の管理画面・iPad に出す案内 */
export const NETWORK_PRINTER_ADMIN_NOTE = 'LAN・Wi-Fi のプリンターは TENPO ONE の運営（コントロールセンター）で設定します';

export const NETWORK_CONNECTIONS = ['lan', 'wifi'] as const;
export type NetworkConnection = (typeof NETWORK_CONNECTIONS)[number];

/** お店の管理画面で選べる接続方式（有線LAN・Wi-Fi は運営だけ） */
export const STORE_PRINTER_CONNECTIONS = ['browser', 'bluetooth', 'usb'] as const;

/** 1 台の iPad に割り当てられる LAN / Wi-Fi のプリンターの数（iPad の保存と同じ） */
export const MAX_DEVICE_NETWORK_PRINTERS = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGES = ['receipt', 'kitchen', 'label'] as const;

export function isNetworkConnection(c: unknown): c is NetworkConnection {
  return c === 'lan' || c === 'wifi';
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

// -------------------------------------------------------------
// プリンターの行（お店の管理画面 /app/settings/printers と運営で同じ入力チェック・同じ列）
// -------------------------------------------------------------

export interface PrinterConfigFields {
  name: string;
  maker: string;
  model: string;
  connectionType: string;
  ipAddress: string;
  usage: string;
  paperWidthMm: number;
  autoPrint: boolean;
  drawerKick: boolean;
  /** 厨房（ドリンク）機から会計伝票も出す */
  billSlips?: boolean;
  /** プリンターを上下さかさまに付けている（印字を180度回して出す） */
  upsideDown?: boolean;
}

/** 入力のチェック。だめなら画面に出す言葉、OK なら null */
export function printerConfigError(input: Pick<PrinterConfigFields, 'name' | 'maker' | 'connectionType' | 'ipAddress'>): string | null {
  if (!input.name.trim()) return 'プリンター名を入力してください';
  // SII RP-F10 など（LAN）はレジの iPad が IP あてに送るので、お店の中の IP が要る（2026-10-16 Ronnie「LAN で」）
  if (printerDeliveryOf({ maker: input.maker, connection: input.connectionType }) === 'ipad-lan' && !parseLanTarget(input.ipAddress)) {
    return 'このプリンターはレジの iPad から LAN で送ります。IPアドレス（192.168.…）を入れてください';
  }
  return null;
}

/** printer_configs に書く列（organization_id・store_id・created_by・updated_by は呼ぶ側で）。floorIds はこの店のフロアに絞ったもの */
export function printerConfigColumns(input: PrinterConfigFields, floorIds: string[]) {
  return {
    name: input.name.trim(),
    maker: input.maker.trim() || null,
    model: input.model.trim() || null,
    connection_type: input.connectionType || null,
    ip_address: input.ipAddress.trim() || null,
    usage: input.usage,
    paper_width_mm: input.paperWidthMm,
    auto_print: input.autoPrint,
    drawer_kick: input.drawerKick,
    floor_ids: input.usage === 'label' ? [] : floorIds,
    bill_slips: input.usage === 'kitchen' ? !!input.billSlips : false,
    upside_down: !!input.upsideDown,
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 運営の「LAN・Wi-Fi のプリンター」の追加・編集 */
export interface NetworkPrinterInput extends PrinterConfigFields {
  /** null なら追加 */
  id: string | null;
  organizationId: string;
  storeId: string;
  connectionType: NetworkConnection;
  floorIds: string[];
  /** このプリンターを使う（実機で印刷する。printer_configs.cloudprnt_enabled） */
  enabled: boolean;
}

/** 画面から来た値を読む（形・種類のチェックだけ。店舗・企業の持ち主かどうかはサーバーで DB を見て確かめる） */
export function parseNetworkPrinterInput(raw: unknown): Parsed<NetworkPrinterInput> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isUuid(r.organizationId) || !isUuid(r.storeId)) return { ok: false, error: '店舗が見つかりません' };
  const id = r.id == null || r.id === '' ? null : isUuid(r.id) ? r.id : undefined;
  if (id === undefined) return { ok: false, error: 'プリンターが見つかりません' };
  if (!isNetworkConnection(r.connectionType)) return { ok: false, error: '接続方式は「有線LAN」か「Wi-Fi」を選んでください' };
  const usage = (USAGES as readonly unknown[]).includes(r.usage) ? (r.usage as string) : null;
  if (!usage) return { ok: false, error: '用途が正しくありません' };
  if (r.paperWidthMm !== 58 && r.paperWidthMm !== 80) return { ok: false, error: '用紙幅は 58mm か 80mm を選んでください' };
  const value: NetworkPrinterInput = {
    id,
    organizationId: r.organizationId,
    storeId: r.storeId,
    name: text(r.name, 60),
    maker: text(r.maker, 40),
    model: text(r.model, 60),
    connectionType: r.connectionType,
    ipAddress: text(r.ipAddress, 64),
    usage,
    paperWidthMm: r.paperWidthMm,
    autoPrint: r.autoPrint === true,
    drawerKick: r.drawerKick === true,
    billSlips: usage === 'kitchen' && r.billSlips === true,
    upsideDown: r.upsideDown === true,
    floorIds: usage === 'label' ? [] : normalizeFloorIds(r.floorIds).filter((f) => UUID.test(f)),
    enabled: r.enabled === true,
  };
  const err = printerConfigError(value);
  if (err) return { ok: false, error: err };
  return { ok: true, value };
}

export interface NetworkPrinterRefInput {
  organizationId: string;
  storeId: string;
  printerId: string;
}

/** 削除など、プリンター 1 台を指すだけの入力 */
export function parseNetworkPrinterRef(raw: unknown): Parsed<NetworkPrinterRefInput> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isUuid(r.organizationId) || !isUuid(r.storeId)) return { ok: false, error: '店舗が見つかりません' };
  if (!isUuid(r.printerId)) return { ok: false, error: 'プリンターが見つかりません' };
  return { ok: true, value: { organizationId: r.organizationId, storeId: r.storeId, printerId: r.printerId } };
}

/**
 * 運営で直してよい行か（この企業・この店舗の、使っている LAN / Wi-Fi のプリンター）。
 * 画面から来た id を、DB から読んだ行で確かめる。
 */
export function isManagedNetworkPrinter(
  row: { organization_id?: unknown; store_id?: unknown; status?: unknown; connection_type?: unknown } | null | undefined,
  ref: { organizationId: string; storeId: string }
): boolean {
  return (
    !!row &&
    row.organization_id === ref.organizationId &&
    row.store_id === ref.storeId &&
    row.status === 'active' &&
    isNetworkConnection(row.connection_type)
  );
}

// -------------------------------------------------------------
// iPad ごとの割り当て
// -------------------------------------------------------------

export interface DeviceNetworkPrintersInput {
  organizationId: string;
  storeId: string;
  deviceId: string;
  /** null は端末まかせ（今までどおり）、[] は送らない */
  lanPrinterIds: string[] | null;
  wifiPrinterIds: string[] | null;
}

/** null / undefined は端末まかせ。配列は UUID だけ・重複なし。8 台を超えたら断る */
function idListInput(v: unknown, label: string): Parsed<string[] | null> {
  if (v == null) return { ok: true, value: null };
  if (!Array.isArray(v)) return { ok: false, error: `${label}の値が正しくありません` };
  const out: string[] = [];
  for (const id of v) {
    if (!isUuid(id) || out.includes(id)) continue;
    out.push(id);
  }
  if (out.length > MAX_DEVICE_NETWORK_PRINTERS) return { ok: false, error: `${label}は ${MAX_DEVICE_NETWORK_PRINTERS} 台までです` };
  return { ok: true, value: out };
}

export function parseDeviceNetworkPrintersInput(raw: unknown): Parsed<DeviceNetworkPrintersInput> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isUuid(r.organizationId) || !isUuid(r.storeId)) return { ok: false, error: '店舗が見つかりません' };
  if (!isUuid(r.deviceId)) return { ok: false, error: '端末が見つかりません' };
  const lan = idListInput(r.lanPrinterIds, 'LAN のプリンター');
  if (!lan.ok) return lan;
  const wifi = idListInput(r.wifiPrinterIds, 'Wi-Fi のプリンター');
  if (!wifi.ok) return wifi;
  return {
    ok: true,
    value: { organizationId: r.organizationId, storeId: r.storeId, deviceId: r.deviceId, lanPrinterIds: lan.value, wifiPrinterIds: wifi.value },
  };
}

/** 運営で選べるプリンター（この店の候補）だけ残す。null（端末まかせ）はそのまま */
export function keepKnownPrinterIds(ids: string[] | null, allowed: ReadonlySet<string>): string[] | null {
  return ids == null ? null : ids.filter((id) => allowed.has(id));
}

/** iPad の候補を決めるのに要る printer_configs の列 */
export interface NetworkPrinterRow {
  id: string;
  name: string;
  maker: string | null;
  usage: string | null;
  connection_type: string | null;
  ip_address: string | null;
  cloudprnt_enabled: boolean | null;
}

export interface NetworkPrinterOption {
  id: string;
  name: string;
  detail: string;
}

const CONNECTION_LABEL: Record<string, string> = { bluetooth: 'Bluetooth', usb: 'USB', lan: '有線LAN', wifi: 'Wi-Fi' };
const USAGE_LABEL: Record<string, string> = { receipt: 'レシート', kitchen: '厨房', drink: 'ドリンク', label: 'ラベル' };

/** 一覧に出す説明（用途・接続・IP） */
export function networkPrinterDetail(row: Pick<NetworkPrinterRow, 'usage' | 'connection_type' | 'ip_address'>): string {
  const usage = row.usage ?? 'receipt';
  const connection = row.connection_type ?? null;
  const ip = (row.ip_address ?? '').trim() || null;
  return [USAGE_LABEL[usage] ?? usage, connection ? (CONNECTION_LABEL[connection] ?? connection) : null, ip].filter(Boolean).join('・');
}

/**
 * iPad ごとに選べる LAN / Wi-Fi のプリンター（lib/native-settings-server.ts と同じ判定）。
 *   lan  … 「使う」になっていて、この iPad から LAN で送れるもの（Star 以外・お店の中の IP）
 *   wifi … 「使う」になっている EPSON で、お店の中の IP があるもの（Wi-Fi で直接印刷）
 */
export function networkPrinterCandidates(rows: readonly NetworkPrinterRow[]): { lan: NetworkPrinterOption[]; wifi: NetworkPrinterOption[] } {
  const lan: NetworkPrinterOption[] = [];
  const wifi: NetworkPrinterOption[] = [];
  for (const p of rows) {
    if (p.cloudprnt_enabled !== true || !isNetworkConnection(p.connection_type)) continue;
    const maker = p.maker ?? null;
    const ip = (p.ip_address ?? '').trim() || null;
    const option: NetworkPrinterOption = { id: p.id, name: p.name, detail: networkPrinterDetail(p) };
    if (isLanRelayPrinter({ maker, connection: p.connection_type, ip })) lan.push(option);
    if (isEpsonMaker(maker) && isLocalPrinterHost(ip)) wifi.push(option);
  }
  return { lan, wifi };
}

/** お店の管理画面の保存：LAN・Wi-Fi は今の値のまま（運営が決める。お店からは変えない） */
export function keepNetworkPrinters(
  next: Pick<DeviceSetting, 'label' | 'printerConfigId' | 'nativePos'>,
  current: DeviceSetting | undefined
): DeviceSetting {
  return {
    label: next.label,
    printerConfigId: next.printerConfigId,
    nativePos: next.nativePos,
    lanPrinterIds: current?.lanPrinterIds ?? null,
    wifiPrinterIds: current?.wifiPrinterIds ?? null,
  };
}

/** 運営の保存：LAN・Wi-Fi だけ変える（表示名・レシートの出し先などは今の値のまま） */
export function withNetworkPrinters(current: DeviceSetting | undefined, lanPrinterIds: string[] | null, wifiPrinterIds: string[] | null): DeviceSetting {
  return { ...(current ?? EMPTY_DEVICE_SETTING), lanPrinterIds, wifiPrinterIds };
}

/** プリンターを消したとき、どの iPad の LAN・Wi-Fi の一覧からも外す（ほかの設定はそのまま）。変わらなければ changed=false */
export function withoutNetworkPrinter(settings: Record<string, unknown>, printerId: string): { settings: Record<string, unknown>; changed: boolean } {
  let next = settings;
  let changed = false;
  for (const [deviceId, s] of Object.entries(deviceSettingsFrom(settings))) {
    const inLan = s.lanPrinterIds?.includes(printerId) ?? false;
    const inWifi = s.wifiPrinterIds?.includes(printerId) ?? false;
    if (!inLan && !inWifi) continue;
    changed = true;
    next = withDeviceSetting(next, deviceId, {
      ...s,
      lanPrinterIds: s.lanPrinterIds ? s.lanPrinterIds.filter((id) => id !== printerId) : null,
      wifiPrinterIds: s.wifiPrinterIds ? s.wifiPrinterIds.filter((id) => id !== printerId) : null,
    });
  }
  return { settings: next, changed };
}

/** お店の管理画面で見せる「この iPad の LAN / Wi-Fi」（読み取りだけ） */
export function describeNetworkPrinterIds(ids: string[] | null, options: readonly NetworkPrinterOption[]): string {
  if (ids == null) return '端末まかせ（今までどおり）';
  if (ids.length === 0) return '送らない';
  const names = ids.map((id) => options.find((o) => o.id === id)?.name).filter((n): n is string => !!n);
  const missing = ids.length - names.length;
  if (names.length === 0) return `今は使えないプリンター ${missing}台`;
  return missing > 0 ? `${names.join('、')}（ほか今は使えないプリンター ${missing}台）` : names.join('、');
}
