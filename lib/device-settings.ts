/**
 * レジ端末（iPad）ごとの設定を管理画面から（2026-10-24 Ronnie「管理画面から全部の設定ができるように。アプリのも、プリンターも」）。
 *   store_settings.settings.devices[register_devices.id] = { label, printerConfigId, nativePos }
 *   - label           … 管理画面で付ける表示名（空なら登録時の名前）
 *   - printerConfigId … このiPadのレシートの出し先（printer_configs.id）。null なら端末で選んだもの → 店の既定
 *   - nativePos       … アプリのオーダー・会計画面（ネイティブ）。true/false で管理画面が決める、null なら端末まかせ
 *   - lanPrinterIds   … LAN のプリンターへ「この iPad から送る」プリンター（2026-10-25 Ronnie「LAN / Wi-Fi は app から
 *                       つながない、control centre から」）。null なら端末まかせ（今までどおり）、[] なら送らない
 *   - wifiPrinterIds  … Wi-Fi で直接印刷するプリンター。null / [] の意味は lanPrinterIds と同じ
 * DB の列は増やさない（移行なし）。純粋な関数だけ（tests/device-settings.test.ts）。
 */

export interface DeviceSetting {
  label: string | null;
  printerConfigId: string | null;
  nativePos: boolean | null;
  lanPrinterIds: string[] | null;
  wifiPrinterIds: string[] | null;
}

export type DeviceSettingsMap = Record<string, DeviceSetting>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL = 40;
const MAX_PRINTERS = 8;

export const EMPTY_DEVICE_SETTING: DeviceSetting = {
  label: null,
  printerConfigId: null,
  nativePos: null,
  lanPrinterIds: null,
  wifiPrinterIds: null,
};

/** プリンター id の一覧（UUID だけ・重複なし・8 台まで（iPad の保存と同じ））。配列でなければ null（＝端末まかせ） */
export function normalizePrinterIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !UUID.test(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_PRINTERS) break;
  }
  return out;
}

export function normalizeDeviceSetting(raw: unknown): DeviceSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : '';
  const printer = typeof r.printerConfigId === 'string' && UUID.test(r.printerConfigId) ? r.printerConfigId : null;
  const native = typeof r.nativePos === 'boolean' ? r.nativePos : null;
  return {
    label: label || null,
    printerConfigId: printer,
    nativePos: native,
    lanPrinterIds: normalizePrinterIds(r.lanPrinterIds),
    wifiPrinterIds: normalizePrinterIds(r.wifiPrinterIds),
  };
}

/** 全部「端末まかせ」なら true（その端末の行は保存しない） */
export function isEmptyDeviceSetting(s: DeviceSetting): boolean {
  return s.label == null && s.printerConfigId == null && s.nativePos == null && s.lanPrinterIds == null && s.wifiPrinterIds == null;
}

/** store_settings.settings から端末ごとの設定を読む（壊れた値は無視） */
export function deviceSettingsFrom(settings: unknown): DeviceSettingsMap {
  const all = (settings as { devices?: unknown } | null)?.devices;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
  const out: DeviceSettingsMap = {};
  for (const [id, raw] of Object.entries(all as Record<string, unknown>)) {
    if (!UUID.test(id)) continue;
    out[id] = normalizeDeviceSetting(raw);
  }
  return out;
}

/** 1 台ぶんを書き戻した settings（ほかの設定はそのまま）。全部空なら、その端末の行を消す */
export function withDeviceSetting(settings: Record<string, unknown>, deviceId: string, setting: Partial<DeviceSetting>): Record<string, unknown> {
  const current = deviceSettingsFrom(settings);
  const next: Record<string, DeviceSetting> = { ...current };
  const clean = normalizeDeviceSetting(setting);
  if (isEmptyDeviceSetting(clean)) delete next[deviceId];
  else next[deviceId] = clean;
  const { devices: _drop, ...rest } = settings;
  void _drop;
  return Object.keys(next).length > 0 ? { ...rest, devices: next } : rest;
}

/** 端末の種類（user_agent から。表示用） */
export function deviceKind(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return '端末';
  if (ua.includes('tenpoone') || ua.includes('tenpo one')) return 'TENPO ONE アプリ';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('macintosh')) return 'iPad / Mac（Safari）';
  if (ua.includes('windows')) return 'Windows';
  return '端末';
}

/** 一覧に出す名前：管理画面で付けた名前 → 登録時の名前 */
export function deviceDisplayName(row: { name: string | null }, setting: DeviceSetting | undefined): string {
  return setting?.label ?? (row.name?.trim() || 'レジ端末');
}

/** nativePos の 3 択（画面の select の値） */
export type NativePosChoice = 'device' | 'on' | 'off';
export function nativePosToChoice(v: boolean | null): NativePosChoice {
  return v === true ? 'on' : v === false ? 'off' : 'device';
}
export function choiceToNativePos(c: string | null | undefined): boolean | null {
  return c === 'on' ? true : c === 'off' ? false : null;
}
