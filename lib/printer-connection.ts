/**
 * 「プリンター接続」（Star CloudPRNT・EPSON Server Direct Print・iPad の Bluetooth / USB / LAN）の行と設定。
 *
 * 2026-10-25 Ronnie「yo data haru pani control centre mai rakhdeu — buti sano compact tarikale」
 *   - 運営（コントロールセンター /admin/organizations/[id]）… 使う／使わない・問い合わせ間隔・ドロア開放コマンド・
 *     伝票（厨房ステーション）・URL の再発行・テスト印刷（app/admin/organizations/printer-connection-actions.ts）
 *   - お店の管理画面（設定 › レジ・プリンター › プリンター接続）… 見るだけ。テスト印刷・ドロアを開くは今まで通り
 * DB の列は増やさない（移行なし）。お店の画面と運営の画面で、接続用URL・状態・入力の扱いを同じにするための純粋な関数だけ
 * （tests/printer-connection.test.ts）。
 */

import { printerDeliveryOf } from '@/lib/direct-print';
import { parseNetworkPrinterRef, type NetworkPrinterRefInput } from '@/lib/network-printers';
import { cloudprntPollSeconds } from '@/lib/cloudprnt-setting';

/** お店の管理画面に出す案内（店舗の Server Action が断るときの言葉も同じ） */
export const PRINTER_CONNECTION_ADMIN_NOTE = '接続の設定は TENPO ONE の運営（コントロールセンター）で行います';

/** プリンター接続の設定を変えられる人（運営＝CYPRESS 管理者だけ。レジ端末の iPad は運営でも不可） */
export function canEditPrinterConnection(ctx: { isCypressAdmin?: boolean | null; isRegisterDevice?: boolean | null }): boolean {
  return ctx.isCypressAdmin === true && ctx.isRegisterDevice !== true;
}

// -------------------------------------------------------------
// 1 台ぶんの行（お店の画面・運営の画面で同じ形）
// -------------------------------------------------------------

export interface PrinterConnectionRow {
  id: string;
  name: string;
  /** メーカー名（'EPSON' / 'Star' 等）。接続方式の判定に使う。 */
  maker: string;
  model: string;
  usage: 'receipt' | 'kitchen';
  /** つなぎ方。'bluetooth' / 'usb' は iPad（TENPO ONE レジ アプリ）とつなぐプリンター（接続用URLは使わない） */
  connectionType?: string | null;
  cloudprntEnabled: boolean;
  /** 接続用URLのトークン。お店の見るだけの画面には渡さない（null） */
  cloudprntToken: string | null;
  drawerKick: boolean;
  drawerCommand: string;
  paperWidthMm: number;
  pollIntervalSeconds: number;
  lastPolledAt: string | null;
  macAddress: string | null;
  kitchenStations: string[];
  pendingJobs: number;
}

/** printer_configs から読む列（お店の画面・運営の画面で同じ） */
export interface PrinterConnectionDbRow {
  id: string;
  name: string;
  maker: string | null;
  model: string | null;
  usage: string;
  connection_type: string | null;
  cloudprnt_enabled: boolean | null;
  cloudprnt_token: string | null;
  drawer_kick: boolean;
  drawer_command: string | null;
  paper_width_mm: number;
  poll_interval_seconds: number | null;
  last_polled_at: string | null;
  mac_address: string | null;
  kitchen_stations: string[] | null;
}

/** 「プリンター接続」に並べる行：用途がレシート・厨房のものだけ、レシート機を先に（同じ用途の中は元の順＝名前順） */
export function printerConnectionRows(
  rows: readonly PrinterConnectionDbRow[],
  pendingByPrinter: ReadonlyMap<string, number> = new Map()
): PrinterConnectionRow[] {
  return rows
    .filter((p) => p.usage === 'receipt' || p.usage === 'kitchen')
    .sort((a, b) => Number(a.usage !== 'receipt') - Number(b.usage !== 'receipt'))
    .map((p) => ({
      id: p.id,
      name: p.name,
      maker: p.maker ?? '',
      model: p.model ?? '',
      usage: p.usage as 'receipt' | 'kitchen',
      connectionType: p.connection_type ?? null,
      cloudprntEnabled: p.cloudprnt_enabled ?? false,
      cloudprntToken: p.cloudprnt_token ?? null,
      drawerKick: p.drawer_kick,
      drawerCommand: p.drawer_command ?? '[drawer: 1]',
      paperWidthMm: p.paper_width_mm,
      pollIntervalSeconds: cloudprntPollSeconds(p.poll_interval_seconds),
      lastPolledAt: p.last_polled_at ?? null,
      macAddress: p.mac_address ?? null,
      kitchenStations: (p.kitchen_stations ?? ['kitchen']) as string[],
      pendingJobs: pendingByPrinter.get(p.id) ?? 0,
    }));
}

/** 未印刷のまま待っているジョブ数（print_jobs の printer_config_id ごと） */
export function pendingJobsByPrinter(jobs: readonly { printer_config_id: string | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const j of jobs) {
    if (!j.printer_config_id) continue;
    out.set(j.printer_config_id, (out.get(j.printer_config_id) ?? 0) + 1);
  }
  return out;
}

// -------------------------------------------------------------
// つなぎ方・接続用URL
// -------------------------------------------------------------

/**
 * メーカーごとの接続方式。
 * Star は CloudPRNT、EPSON（TM-m30III-H 等のTMインテリジェント機）は Server Direct Print で、
 * どちらも「プリンタが定期的にTENPO ONEへ問い合わせて印刷データを受け取る」同じ考え方。
 */
export function makerKind(maker: string | null | undefined): 'epson' | 'star' {
  return /epson/i.test(maker ?? '') ? 'epson' : 'star';
}

export const CONNECTION_PROTOCOL = {
  star: { path: 'cloudprnt', label: 'CloudPRNT', urlField: 'CloudPRNT「サーバーURL」', app: 'Star Quick Setup Utility' },
  epson: {
    path: 'epson',
    label: 'Server Direct Print',
    urlField: 'Server Direct Print「サーバー1 URL」',
    app: 'Epson TM Utility',
  },
} as const;

/**
 * どうやって印刷データが届くか。
 *   cloudprnt … Star などがプリンターから取りに来る（接続用URL /api/cloudprnt/…）
 *   sdp       … EPSON が Server Direct Print で取りに来る（接続用URL /api/epson/…）
 *   ipad      … iPad（TENPO ONE レジ アプリ）と Bluetooth / USB でつなぐ（接続用URLは使わない）
 *   ipad-lan  … SII RP-F10 など。レジの iPad がお店の LAN で送る（接続用URLは使わない）
 */
export type PrinterConnectionKind = 'cloudprnt' | 'sdp' | 'ipad' | 'ipad-lan';

export function printerConnectionKind(p: { maker?: string | null; connectionType?: string | null }): PrinterConnectionKind {
  if (p.connectionType === 'bluetooth' || p.connectionType === 'usb') return 'ipad';
  if (printerDeliveryOf({ maker: p.maker, connection: p.connectionType }) === 'ipad-lan') return 'ipad-lan';
  return makerKind(p.maker) === 'epson' ? 'sdp' : 'cloudprnt';
}

/** 一覧に出すつなぎ方の短い名前 */
export function printerConnectionKindLabel(p: { maker?: string | null; connectionType?: string | null }): string {
  switch (printerConnectionKind(p)) {
    case 'ipad':
      return p.connectionType === 'usb' ? 'iPad USB' : 'iPad Bluetooth';
    case 'ipad-lan':
      return 'iPad LAN';
    case 'sdp':
      return 'EPSON SDP';
    default:
      return 'CloudPRNT';
  }
}

/** 接続用URL（プリンターの CloudPRNT「サーバーURL」/ Server Direct Print「サーバー1 URL」に入れる）。作れなければ '' */
export function printerConnectionUrl(siteUrl: string, maker: string | null | undefined, token: string | null | undefined): string {
  if (!siteUrl || !token) return '';
  return `${siteUrl}/api/${CONNECTION_PROTOCOL[makerKind(maker)].path}/${token}`;
}

/** 接続用URLを使うつなぎ方か（iPad とつなぐもの・iPad から LAN で送るものは使わない） */
export function usesConnectionUrl(kind: PrinterConnectionKind): boolean {
  return kind === 'cloudprnt' || kind === 'sdp';
}

// -------------------------------------------------------------
// 状態（最後にプリンター（または iPad）が取りに来た時刻 last_polled_at から）
// -------------------------------------------------------------

/** 接続中とみなす最終通信からの経過（ポーリング間隔の数倍に余裕を持たせる） */
export const PRINTER_ONLINE_WITHIN_MS = 60_000;

export type PrinterConnectionStatus = 'checking' | 'online' | 'offline' | 'never' | 'disabled';

/** now=0 はまだ時計が無い（サーバーで描いたとき）＝確認中 */
export function printerConnectionStatus(p: { cloudprntEnabled: boolean; lastPolledAt: string | null }, now: number): PrinterConnectionStatus {
  if (!p.cloudprntEnabled) return 'disabled';
  if (!p.lastPolledAt) return 'never';
  if (now === 0) return 'checking';
  return now - new Date(p.lastPolledAt).getTime() <= PRINTER_ONLINE_WITHIN_MS ? 'online' : 'offline';
}

/** 「12秒前」「3分前」…（1 日を超えたら日時） */
export function polledAgo(iso: string, now: number): string {
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.round(sec / 60)}分前`;
  if (sec < 86400) return `${Math.round(sec / 3600)}時間前`;
  return new Date(iso).toLocaleString('ja-JP');
}

// -------------------------------------------------------------
// 設定の項目
// -------------------------------------------------------------

/** 厨房機が担当できる厨房ステーション（printer_configs.kitchen_stations） */
export const CLOUDPRNT_KITCHEN_STATIONS = ['kitchen', 'drink', 'dessert', 'grill'] as const;

/** 画面に出す順と名前 */
export const KITCHEN_STATION_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'kitchen', label: 'キッチン（フード）' },
  { key: 'drink', label: 'ドリンク' },
  { key: 'grill', label: '焼き場（焼き鳥）' },
  { key: 'dessert', label: 'デザート' },
];

export const KITCHEN_STATIONS_REQUIRED = '担当する厨房（キッチン／焼き場／ドリンク／デザート）を1つ以上選んでください';

/** 伝票の名前を「・」でつなぐ（見るだけの画面） */
export function kitchenStationsLabel(stations: readonly string[]): string {
  const names = KITCHEN_STATION_OPTIONS.filter((s) => stations.includes(s.key)).map((s) => s.label);
  return names.length > 0 ? names.join('・') : '—';
}

/**
 * ドロアの入れ方：EPSON 機・iPad から LAN で送る機（ESC/POS）はピン番号を選ぶ、それ以外（Star）はコマンド文字列。
 * ドロア連動のレシート機だけ。
 */
export function drawerFieldOf(p: { usage: string; drawerKick: boolean; maker?: string | null; connectionType?: string | null }): 'none' | 'pin' | 'command' {
  if (p.usage === 'kitchen' || !p.drawerKick) return 'none';
  return makerKind(p.maker) === 'epson' || printerConnectionKind(p) === 'ipad-lan' ? 'pin' : 'command';
}

/** ピンの選択肢に合わせた値（'[drawer: 2]'＝5番ピン、ほかは '[drawer: 1]'＝2番ピン） */
export function drawerPinValue(command: string): '[drawer: 1]' | '[drawer: 2]' {
  return command.includes('2') ? '[drawer: 2]' : '[drawer: 1]';
}

export function drawerPinLabel(command: string): string {
  return drawerPinValue(command) === '[drawer: 2]' ? '5番ピン' : '2番ピン（通常）';
}

/** 問い合わせ間隔を使うつなぎ方か（プリンターから取りに来るものだけ） */
export function usesPollInterval(kind: PrinterConnectionKind): boolean {
  return kind === 'cloudprnt' || kind === 'sdp';
}

// -------------------------------------------------------------
// 保存の中身（店舗の setCloudPrntConfig と運営で同じ組み立て）
// -------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CloudPrntConfigFields {
  enabled: boolean;
  drawerCommand?: string;
  pollIntervalSeconds?: number;
  /** キッチン機が担当する厨房ステーション（kitchen / drink / dessert / grill） */
  kitchenStations?: string[];
}

/**
 * printer_configs に書く列（updated_by は呼ぶ側で）。店舗の setCloudPrntConfig と同じ扱い：
 *   ドロア … 空なら今のまま、問い合わせ間隔 … 1〜60 秒に丸める（0 以下は今のまま）、伝票 … 知らない値は捨て、空なら断る
 */
export function cloudPrntConfigPatch(input: CloudPrntConfigFields): Parsed<Record<string, unknown>> {
  const patch: Record<string, unknown> = { cloudprnt_enabled: input.enabled };
  if (typeof input.drawerCommand === 'string' && input.drawerCommand.trim()) {
    patch.drawer_command = input.drawerCommand.trim();
  }
  if (typeof input.pollIntervalSeconds === 'number' && input.pollIntervalSeconds > 0) {
    patch.poll_interval_seconds = Math.min(60, Math.max(1, Math.round(input.pollIntervalSeconds)));
  }
  if (input.kitchenStations) {
    const stations = Array.from(new Set(input.kitchenStations)).filter((s): s is (typeof CLOUDPRNT_KITCHEN_STATIONS)[number] =>
      (CLOUDPRNT_KITCHEN_STATIONS as readonly string[]).includes(s)
    );
    if (stations.length === 0) return { ok: false, error: KITCHEN_STATIONS_REQUIRED };
    patch.kitchen_stations = stations;
  }
  return { ok: true, value: patch };
}

/** ドロア開放コマンドの長さ（'[drawer: 1]' などの短い文字列） */
export const MAX_DRAWER_COMMAND_LENGTH = 64;

/** 運営の「保存」（このプリンタを使う・問い合わせ間隔・ドロア・伝票） */
export interface PrinterConnectionInput extends CloudPrntConfigFields, NetworkPrinterRefInput {}

/** 画面から来た値を読む（形・範囲のチェックだけ。企業・店舗・プリンターの持ち主かどうかはサーバーで DB を見て確かめる） */
export function parsePrinterConnectionInput(raw: unknown): Parsed<PrinterConnectionInput> {
  const ref = parseNetworkPrinterRef(raw);
  if (!ref.ok) return ref;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean') return { ok: false, error: '「このプリンタを使う」の値が正しくありません' };
  const value: PrinterConnectionInput = { ...ref.value, enabled: r.enabled };

  if (r.pollIntervalSeconds != null) {
    const n = r.pollIntervalSeconds;
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.round(n) < 1 || Math.round(n) > 60) {
      return { ok: false, error: '問い合わせ間隔は 1〜60 秒で入れてください' };
    }
    value.pollIntervalSeconds = Math.round(n);
  }
  if (r.drawerCommand != null) {
    if (typeof r.drawerCommand !== 'string') return { ok: false, error: 'ドロア開放コマンドが正しくありません' };
    const cmd = r.drawerCommand.trim();
    if (cmd.length > MAX_DRAWER_COMMAND_LENGTH) return { ok: false, error: `ドロア開放コマンドは ${MAX_DRAWER_COMMAND_LENGTH} 文字までです` };
    if (cmd) value.drawerCommand = cmd;
  }
  if (r.kitchenStations != null) {
    if (!Array.isArray(r.kitchenStations)) return { ok: false, error: KITCHEN_STATIONS_REQUIRED };
    const stations = r.kitchenStations.filter((s): s is string => typeof s === 'string');
    if (!stations.some((s) => (CLOUDPRNT_KITCHEN_STATIONS as readonly string[]).includes(s))) return { ok: false, error: KITCHEN_STATIONS_REQUIRED };
    value.kitchenStations = stations;
  }
  return { ok: true, value };
}

export type PrinterTestKind = 'receipt' | 'drawer';

/** 運営の「テスト印刷」「ドロアを開く」 */
export function parsePrinterConnectionTestInput(raw: unknown): Parsed<NetworkPrinterRefInput & { kind: PrinterTestKind }> {
  const ref = parseNetworkPrinterRef(raw);
  if (!ref.ok) return ref;
  const kind = (raw as Record<string, unknown>).kind;
  if (kind !== 'receipt' && kind !== 'drawer') return { ok: false, error: '操作が正しくありません' };
  return { ok: true, value: { ...ref.value, kind } };
}

/** 運営の「URLを再発行」など、プリンター 1 台を指すだけの入力 */
export const parsePrinterConnectionRef = parseNetworkPrinterRef;

/**
 * 運営で直してよい行か（この企業・この店舗の、使っているレシート・厨房のプリンター）。
 * 画面から来た id を、DB から読んだ行で確かめる。
 */
export function isConnectionPrinterOf(
  row: { organization_id?: unknown; store_id?: unknown; status?: unknown; usage?: unknown } | null | undefined,
  ref: { organizationId: string; storeId: string }
): boolean {
  return (
    !!row &&
    row.organization_id === ref.organizationId &&
    row.store_id === ref.storeId &&
    row.status === 'active' &&
    (row.usage === 'receipt' || row.usage === 'kitchen')
  );
}
