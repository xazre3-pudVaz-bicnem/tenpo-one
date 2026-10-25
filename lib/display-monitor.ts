/**
 * ディスプレイ（モニター）端末の共通ロジック（純関数・テスト対象。DB・Next に依存しない）。
 * 2026-10-24 23:47–23:53 Ronnie「デバイス管理にディスプレイ（モニター）を追加。QR でつなぐ。
 * QR でつないだらログアウトしない。ただしお店の回線は必要。CYPRESS の運営コンソールから企業ごと・店舗ごとに ON（既定 OFF）」
 *
 *   kind = 'kitchen' … キッチンディスプレイ（KDS）。stations で持ち場を絞れる（空＝すべて）
 *   kind = 'call'    … 呼び出しモニター（「調理中」「できあがり」の番号）
 *
 * ペアリング（QR・5分・1回・発行したレジと同じ回線）はハンディと同じ（lib/display-pairing.ts → lib/handy-pairing.ts）。
 * このファイルはブラウザでも読む（node:crypto を使うものは lib/display-pairing.ts に置く）。
 */
/** feature_flags / store_feature_flags の flag_key */
export const DISPLAY_MONITOR_FLAG = 'display_monitor';

export const DISPLAY_KINDS = ['kitchen', 'call'] as const;
export type DisplayKind = (typeof DISPLAY_KINDS)[number];

export const DISPLAY_KIND_LABELS: Record<DisplayKind, string> = {
  kitchen: 'キッチンディスプレイ',
  call: '呼び出しモニター',
};

export function isDisplayKind(v: unknown): v is DisplayKind {
  return typeof v === 'string' && (DISPLAY_KINDS as readonly string[]).includes(v);
}

/** 持ち場（menu_categories.station と同じ値）。components/kitchen/types.ts の Station と同じ並び */
export const DISPLAY_STATIONS = ['kitchen', 'grill', 'drink', 'dessert'] as const;
export type DisplayStation = (typeof DISPLAY_STATIONS)[number];
export const DISPLAY_STATION_LABELS: Record<DisplayStation, string> = {
  kitchen: 'キッチン',
  grill: '焼き場',
  drink: 'ドリンク',
  dessert: 'デザート',
};

/** 持ち場の指定を読み直す（知らない値は捨てる・重複なし・決まった並び）。空＝すべて */
export function normalizeStations(v: unknown): DisplayStation[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter((s): s is string => typeof s === 'string'));
  return DISPLAY_STATIONS.filter((s) => set.has(s));
}

/** 持ち場の表示（空＝すべて） */
export function stationsLabel(stations: readonly string[]): string {
  const list = normalizeStations(stations);
  return list.length === 0 ? 'すべて' : list.map((s) => DISPLAY_STATION_LABELS[s]).join('・');
}

// -------------------------------------------------------------
// 機能の ON/OFF（企業 × 店舗。どちらも ON のときだけ使える。既定 OFF）
// -------------------------------------------------------------

export type DisplayMonitorFlagReason = 'on' | 'company_off' | 'store_off' | 'not_ready';

export interface DisplayMonitorFlagState {
  on: boolean;
  reason: DisplayMonitorFlagReason;
}

/**
 * 企業の行（feature_flags）と店舗の行（store_feature_flags）から、使えるかを決める。
 * どちらも enabled = true の行があるときだけ ON。行が無い（null）＝ OFF
 * （ほかの機能フラグの「行が無ければ ON」とは逆。display_monitor だけの決まり）。
 * 店舗の表がまだ無い（migration 00103 未適用）ときは not_ready ＝ OFF。
 */
export function resolveDisplayMonitorFlag(input: {
  orgEnabled: boolean | null;
  storeEnabled: boolean | null;
  storeTableMissing?: boolean;
}): DisplayMonitorFlagState {
  if (input.storeTableMissing) return { on: false, reason: 'not_ready' };
  if (input.orgEnabled !== true) return { on: false, reason: 'company_off' };
  if (input.storeEnabled !== true) return { on: false, reason: 'store_off' };
  return { on: true, reason: 'on' };
}

export const DISPLAY_FLAG_MESSAGE: Record<Exclude<DisplayMonitorFlagReason, 'on'>, string> = {
  company_off: 'この機能は使えません（運営にお問い合わせください）',
  store_off: 'この機能は使えません（運営にお問い合わせください）',
  not_ready: 'この機能は使えません（運営にお問い合わせください）',
};

/** 運営コンソール向けの説明（なぜ OFF か） */
export const DISPLAY_FLAG_ADMIN_NOTE: Record<DisplayMonitorFlagReason, string> = {
  on: '使えます',
  company_off: '企業が OFF',
  store_off: '店舗が OFF',
  not_ready: 'migration 00103 が未適用のため使えません',
};

// -------------------------------------------------------------
// お店の回線（ハンディの checkHandyNetwork と同じ「お店の回線」。ちがうのはログアウトしないこと）
// -------------------------------------------------------------

/**
 * この回線から画面を出してよいか。
 *   guarded … 運営が回線を登録して制限している店（store_access_policies）か、
 *             iPhoneハンディで「お店のWi-Fiだけで使う」をオンにして回線を登録した店
 *   inside  … 今の接続元がその回線のどれか
 * 回線を登録していない店は判定できないので出す（レジ・ハンディと同じ）。外にいても解除・ログアウトはしない。
 */
export function displayNetworkAllowed(input: { guarded: boolean; inside: boolean }): boolean {
  return !input.guarded || input.inside;
}

export const DISPLAY_OFF_NETWORK_MESSAGE = 'お店の回線につないでください';

// -------------------------------------------------------------
// 一覧の表示（使用中・機種）
// -------------------------------------------------------------

/** これより新しく通信していれば「使用中」 */
export const DISPLAY_ONLINE_MS = 3 * 60_000;

export function isDisplayOnline(lastSeenAt: string | null, now: number): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return Number.isFinite(t) && now - t < DISPLAY_ONLINE_MS;
}

/** last_seen_at を書き直すか（毎回は書かない。1分に1回まで） */
export function shouldTouchLastSeen(lastSeenAt: string | null, now: number): boolean {
  if (!lastSeenAt) return true;
  const t = new Date(lastSeenAt).getTime();
  return !Number.isFinite(t) || now - t >= 60_000;
}

/** User-Agent から「iPad · iPadOS 17.1」「Android 14」「Windows」など（分からなければ「ブラウザ」） */
export function deviceModelFromUserAgent(ua: string | null | undefined): string {
  if (!ua) return '端末の種類 不明';
  const ver = (re: RegExp) => {
    const m = re.exec(ua);
    return m ? m[1].replace(/_/g, '.') : null;
  };
  if (/iPad/.test(ua)) {
    const v = ver(/OS (\d+(?:[._]\d+)*)/);
    return `iPad${v ? ` · iPadOS ${v}` : ''}`;
  }
  if (/iPhone/.test(ua)) {
    const v = ver(/OS (\d+(?:[._]\d+)*)/);
    return `iPhone${v ? ` · iOS ${v}` : ''}`;
  }
  if (/AFT[A-Z0-9]|Fire TV/i.test(ua)) return 'Fire TV';
  if (/Android/.test(ua)) {
    const v = ver(/Android (\d+(?:\.\d+)*)/);
    const tv = /\bTV\b|SmartTV|BRAVIA|AndroidTV|GoogleTV/i.test(ua);
    return `${tv ? 'Android TV' : 'Android'}${v ? ` ${v}` : ''}`;
  }
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Windows/.test(ua)) return 'Windows';
  // iPadOS の Safari は「Macintosh」と名乗ることがある（タッチできるかはここでは分からない）
  if (/Macintosh/.test(ua)) return 'Mac / iPad';
  if (/Linux/.test(ua)) return 'Linux';
  return 'ブラウザ';
}

// -------------------------------------------------------------
// 呼び出しモニター（「調理中」「できあがり」）
// -------------------------------------------------------------

export type CallKitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

export interface CallBoardOrderInput {
  orderId: string;
  /** スタッフが見ている注文番号（KDS・厨房伝票の #番号＝orders.order_no） */
  orderNo: number;
  /** orders.status（open 以外＝会計済み・取消は出さない） */
  status: string;
  tableName: string | null;
  /** 厨房に出した品目だけ（メニューの商品・取消でないもの） */
  items: { kitchenStatus: CallKitchenStatus; createdAt: string; readyAt: string | null }[];
}

export interface CallBoardEntry {
  orderId: string;
  orderNo: number;
  tableName: string | null;
  /** 調理中: いちばん古い品目の時刻 / できあがり: できあがった時刻 */
  since: string;
}

export interface CallBoard {
  cooking: CallBoardEntry[];
  ready: CallBoardEntry[];
}

const isDone = (s: CallKitchenStatus) => s === 'ready' || s === 'served';

/**
 * 注文ごとに「調理中」「できあがり」に分ける。
 *   - できあがり: 厨房の品目がすべて完成（ready）か提供済（served）で、まだ提供していない品目がある
 *   - 調理中: 未着手・調理中の品目がある
 *   - 出さない: 全部提供済（＝お渡し済み）、会計済み・取消（open でない）、厨房の品目が無い
 * 並び: 調理中は古い順、できあがりは新しくできた順（いちばん上が最新）
 */
export function buildCallBoard(orders: readonly CallBoardOrderInput[]): CallBoard {
  const cooking: CallBoardEntry[] = [];
  const ready: CallBoardEntry[] = [];
  for (const o of orders) {
    if (o.status !== 'open') continue;
    if (o.items.length === 0) continue;
    if (o.items.every((i) => i.kitchenStatus === 'served')) continue;
    const base = { orderId: o.orderId, orderNo: o.orderNo, tableName: o.tableName };
    if (o.items.every((i) => isDone(i.kitchenStatus))) {
      const readyTimes = o.items.map((i) => (i.readyAt ? new Date(i.readyAt).getTime() : NaN)).filter(Number.isFinite);
      const created = o.items.map((i) => new Date(i.createdAt).getTime()).filter(Number.isFinite);
      const at = readyTimes.length > 0 ? Math.max(...readyTimes) : created.length > 0 ? Math.max(...created) : 0;
      ready.push({ ...base, since: new Date(at).toISOString() });
    } else {
      const created = o.items
        .filter((i) => !isDone(i.kitchenStatus))
        .map((i) => new Date(i.createdAt).getTime())
        .filter(Number.isFinite);
      const at = created.length > 0 ? Math.min(...created) : 0;
      cooking.push({ ...base, since: new Date(at).toISOString() });
    }
  }
  cooking.sort((a, b) => a.since.localeCompare(b.since) || a.orderNo - b.orderNo);
  ready.sort((a, b) => b.since.localeCompare(a.since) || b.orderNo - a.orderNo);
  return { cooking, ready };
}

/**
 * 新しく「できあがり」に入った注文（チャイムを鳴らす対象）。
 * 前回の一覧が無い（画面を開いた直後）ときは鳴らさない（今ある番号を「新しい」と間違えないため）。
 */
export function newlyReadyIds(previous: ReadonlySet<string> | null, ready: readonly { orderId: string }[]): string[] {
  if (!previous) return [];
  return ready.filter((r) => !previous.has(r.orderId)).map((r) => r.orderId);
}

// -------------------------------------------------------------
// 設定の画面（Web の /app/settings/displays と iPad の設定 › ディスプレイ端末 で同じ形）
// -------------------------------------------------------------

export interface DisplayDeviceListRow {
  id: string;
  name: string;
  kind: DisplayKind;
  kindLabel: string;
  stations: DisplayStation[];
  stationsLabel: string;
  status: 'active' | 'revoked';
  pairedAt: string;
  lastSeenAt: string | null;
  pairedIp: string | null;
  lastIp: string | null;
  userAgent: string | null;
  /** User-Agent から（iPad · iPadOS 17.1 など） */
  deviceModel: string;
}

export interface DisplayDevicesPayload {
  store: { id: string; name: string };
  /** QR発行・名前・種類・解除ができる（店長以上） */
  canEdit: boolean;
  /** 運営がこの企業・店舗で ON にしているか */
  flagOn: boolean;
  /** OFF のときの文（ON なら null） */
  flagMessage: string | null;
  /** migration 00103 未適用（表が無い） */
  notReady: boolean;
  /** QR に入れる登録ページ（siteUrl + /display-pair#）。無ければ QR を作れない */
  pairBase: string | null;
  kinds: { id: DisplayKind; label: string }[];
  stations: { id: DisplayStation; label: string }[];
  devices: DisplayDeviceListRow[];
}

// -------------------------------------------------------------
// iPad アプリの操作の読み取り（純関数）
//   設定 › ディスプレイ端末（店長以上の iPad。lib/native-modules/display-devices.ts）
//   ディスプレイとしてつないだ iPad 自身（app/api/app/v1/display/route.ts）
// -------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuidValue = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const deviceNameOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');

/** 設定 › ディスプレイ端末 の操作（POST type）。Web の app/app/settings/displays/actions.ts と同じ4つ */
export const DISPLAY_DEVICE_ACTION_TYPES = ['displayIssue', 'displayRevoke', 'displayRename', 'displayUpdate'] as const;
export type DisplayDeviceActionType = (typeof DISPLAY_DEVICE_ACTION_TYPES)[number];

export type DisplayDeviceAction =
  | { type: 'displayIssue'; deviceName: string; kind: DisplayKind; stations: DisplayStation[] }
  | { type: 'displayRevoke'; id: string }
  | { type: 'displayRename'; id: string; name: string }
  | { type: 'displayUpdate'; id: string; kind: DisplayKind; stations: DisplayStation[] };

export function parseDisplayDeviceAction(raw: unknown): { ok: true; action: DisplayDeviceAction } | { ok: false; error: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (error = '内容が正しくありません') => ({ ok: false as const, error });
  switch (b.type) {
    case 'displayIssue': {
      const deviceName = deviceNameOf(b.deviceName);
      if (!deviceName) return bad('端末の名前を入力してください');
      if (!isDisplayKind(b.kind)) return bad('種類を選んでください');
      return { ok: true, action: { type: 'displayIssue', deviceName, kind: b.kind, stations: normalizeStations(b.stations) } };
    }
    case 'displayRevoke':
      if (!isUuidValue(b.id)) return bad('端末が見つかりません');
      return { ok: true, action: { type: 'displayRevoke', id: b.id } };
    case 'displayRename': {
      if (!isUuidValue(b.id)) return bad('端末が見つかりません');
      const name = deviceNameOf(b.name);
      if (!name) return bad('端末の名前を入力してください');
      return { ok: true, action: { type: 'displayRename', id: b.id, name } };
    }
    case 'displayUpdate':
      if (!isUuidValue(b.id)) return bad('端末が見つかりません');
      if (!isDisplayKind(b.kind)) return bad('種類を選んでください');
      return { ok: true, action: { type: 'displayUpdate', id: b.id, kind: b.kind, stations: normalizeStations(b.stations) } };
    default:
      return bad();
  }
}

/** キッチンの品目の状態（未着手 → 調理中 → 完成 → 提供済。/app/kitchen と同じ一方向） */
export type DisplayKitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';
export const DISPLAY_NEXT_STATUS: Record<DisplayKitchenStatus, DisplayKitchenStatus | null> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'served',
  served: null,
};

/** ディスプレイとしてつないだ iPad 自身の操作（POST /api/app/v1/display） */
export type DisplayAppAction =
  /** QR の値で、この iPad をディスプレイとして登録する（未ログインから） */
  | { type: 'pair'; code: string }
  /** キッチン：品目を次の段階へ */
  | { type: 'advance'; itemId: string; next: Exclude<DisplayKitchenStatus, 'pending'> }
  /** キッチン：カードの品目をまとめて提供済に（itemIds＝画面に出ている品目だけ） */
  | { type: 'served'; orderId: string; itemIds: string[] }
  /** 数分ごとの見守り（端末の鍵の期限を延ばす・使用中の記録） */
  | { type: 'heartbeat' }
  /** この iPad をディスプレイからレジに戻す（この端末を解除してログアウト） */
  | { type: 'leave' };

export function parseDisplayAppAction(raw: unknown): { ok: true; action: DisplayAppAction } | { ok: false; error: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (error = '内容が正しくありません') => ({ ok: false as const, error });
  switch (b.type) {
    case 'pair': {
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!/^[0-9a-f]{48}$/i.test(code)) return bad('このQRコードは使えません。設定 → ディスプレイ端末 で新しいQRコードを表示してください');
      return { ok: true, action: { type: 'pair', code } };
    }
    case 'advance': {
      if (!isUuidValue(b.itemId)) return bad();
      if (b.next !== 'preparing' && b.next !== 'ready' && b.next !== 'served') return bad();
      return { ok: true, action: { type: 'advance', itemId: b.itemId, next: b.next } };
    }
    case 'served': {
      if (!isUuidValue(b.orderId)) return bad();
      const itemIds = Array.isArray(b.itemIds) ? b.itemIds.filter(isUuidValue).slice(0, 200) : [];
      return { ok: true, action: { type: 'served', orderId: b.orderId, itemIds } };
    }
    case 'heartbeat':
      return { ok: true, action: { type: 'heartbeat' } };
    case 'leave':
      return { ok: true, action: { type: 'leave' } };
    default:
      return bad();
  }
}

// -------------------------------------------------------------
// /display を開いた端末の状態 → 出す画面（Web の /display と iPad アプリのネイティブのディスプレイで同じ決め方）
// -------------------------------------------------------------

/** display_devices の1行（画面・操作で使う分だけ） */
export interface DisplayDevice {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  kind: DisplayKind;
  stations: DisplayStation[];
  profileId: string;
  status: 'active' | 'revoked';
  lastSeenAt: string | null;
}

export type DisplayRequestState =
  /** まだつないでいない（QR を読んでいない）。staffSignedIn はスタッフのアカウントで開いているとき */
  | { kind: 'unpaired'; staffSignedIn: boolean }
  /** migration 00103 未適用 */
  | { kind: 'not_ready' }
  /** セッションが切れている → 端末の鍵でつなぎ直す */
  | { kind: 'resume' }
  | { kind: 'revoked'; name: string | null }
  /** 通信が不安定（認証サーバーに届かない等）。少し待って読み直す */
  | { kind: 'transient' }
  | {
      kind: 'ready';
      device: DisplayDevice;
      storeName: string;
      flag: DisplayMonitorFlagState;
      onNetwork: boolean;
    };

export type DisplayNoticeIcon = 'network' | 'off' | 'revoked' | 'loading' | 'unpaired';

export interface DisplayNotice {
  screen: 'notice';
  icon: DisplayNoticeIcon;
  title: string;
  body: string | null;
  footer: string | null;
  /** 自分で読み直す間隔（null＝読み直さない。解除済み・未登録は人が QR を読むまで変わらない） */
  refreshMs: number | null;
  /** 端末の見守り（鍵の期限を延ばす・使用中の記録）を続けるか＝つないである端末 */
  heartbeat: boolean;
}

export type DisplayScreen =
  | DisplayNotice
  /** セッションが切れた → 端末の鍵でつなぎ直す */
  | { screen: 'resume' }
  /** キッチンディスプレイ／呼び出しモニターを出す */
  | { screen: 'board'; kind: DisplayKind };

const SETTINGS_PATH_LABEL = 'レジの「設定 → デバイス管理 → ディスプレイ端末」';

/**
 * 端末の状態から出す画面を決める（純関数）。ログアウト・解除はしない：
 * 回線の外なら「お店の回線につないでください」、機能 OFF なら「この機能は使えません」を出して読み直し続ける。
 */
export function displayScreenOf(state: DisplayRequestState): DisplayScreen {
  const notice = (n: Omit<DisplayNotice, 'screen'>): DisplayNotice => ({ screen: 'notice', ...n });
  switch (state.kind) {
    case 'unpaired':
      return notice({
        icon: 'unpaired',
        title: 'この端末はまだディスプレイとして登録されていません',
        body: state.staffSignedIn
          ? `スタッフのアカウントで開いています。ディスプレイにするには、${SETTINGS_PATH_LABEL}でQRコードを表示し、この端末で読み取ってください。`
          : `${SETTINGS_PATH_LABEL}でQRコードを表示し、この端末（お店の回線につないだ状態）で読み取ってください。`,
        footer: null,
        refreshMs: null,
        heartbeat: false,
      });
    case 'not_ready':
      return notice({ icon: 'off', title: DISPLAY_FLAG_MESSAGE.not_ready, body: null, footer: null, refreshMs: 60_000, heartbeat: false });
    case 'resume':
      return { screen: 'resume' };
    case 'revoked':
      return notice({
        icon: 'revoked',
        title: 'この端末は解除されました',
        body: `${state.name ? `「${state.name}」は` : ''}お店の設定で解除されました。もう一度使うには、${SETTINGS_PATH_LABEL}でQRコードを表示して読み取ってください。`,
        footer: null,
        refreshMs: null,
        heartbeat: false,
      });
    case 'transient':
      return notice({
        icon: 'loading',
        title: '接続を確認しています…',
        body: 'このままお待ちください（ログアウトはしていません）',
        footer: null,
        refreshMs: 10_000,
        heartbeat: false,
      });
    case 'ready': {
      const footer = `${state.storeName}・${state.device.name}`;
      if (!state.flag.on) {
        return notice({
          icon: 'off',
          title: DISPLAY_FLAG_MESSAGE[state.flag.reason === 'on' ? 'company_off' : state.flag.reason],
          body: null,
          footer,
          refreshMs: 60_000,
          heartbeat: true,
        });
      }
      if (!state.onNetwork) {
        return notice({
          icon: 'network',
          title: DISPLAY_OFF_NETWORK_MESSAGE,
          body: 'この端末をお店のWi-Fi・有線につなぐと、自動で元の画面に戻ります。\n（ログアウト・解除はしていません）',
          footer,
          refreshMs: 15_000,
          heartbeat: true,
        });
      }
      return { screen: 'board', kind: state.device.kind };
    }
  }
}
