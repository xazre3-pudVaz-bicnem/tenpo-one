/**
 * 端末（レジ iPad・ハンディ・ディスプレイ端末）の契約と承認 — コントロールセンター（運営コンソール /admin）。
 * 2026-10-25 14:37 Ronnie「ipad lai dine 契約 on off, handy 端末 kati ota vanne yesta kura haru sabai control centre ma.
 *   ipad monitor sabai control centre le ok garepaxi balla chalxa. 店舗管理画面 ma just dashboard ra shop ko sano tino setting haru menu haru」
 *
 *   - 契約 ON/OFF と台数は運営が店舗ごとに決める（store_access_policies。ディスプレイの ON/OFF は display_monitor の機能フラグ）
 *   - 新しい端末は「承認待ち」で作られ、運営が承認するまで使えない（register_devices / handy_devices / display_devices の approval_status）
 *   - 今使っている端末は全部「承認済み」（migration 00104 の既定値）。migration の前は今まで通り（承認なし）
 *   - 店舗の管理画面は一覧・状態を見るだけ（承認・解除・台数はここ）
 *
 * このファイルは純粋な関数だけ（DB・Next 非依存・テスト対象）。DB の読み書きは lib/device-control-server.ts。
 */

export const DEVICE_TYPES = ['register', 'handy', 'display'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  register: 'レジ（iPad）',
  handy: 'ハンディ',
  display: 'ディスプレイ端末',
};

/** 端末の表 */
export const DEVICE_TABLES: Record<DeviceType, 'register_devices' | 'handy_devices' | 'display_devices'> = {
  register: 'register_devices',
  handy: 'handy_devices',
  display: 'display_devices',
};

export function isDeviceType(v: unknown): v is DeviceType {
  return typeof v === 'string' && (DEVICE_TYPES as readonly string[]).includes(v);
}

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'revoked'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  revoked: '運営が解除',
};

/**
 * DB の値から読む。列が無い（migration 00104 の前）・空・知らない値は「承認済み」
 * （今使っている端末を止めないため。新しい端末はアプリが pending で作る）。
 */
export function approvalFrom(v: unknown): ApprovalStatus {
  return v === 'pending' || v === 'rejected' || v === 'revoked' ? v : 'approved';
}

/** 台数の入力を 0〜20 に丸める（壊れた値は既定に戻す。lib/store-access.ts の limitFrom と同じ決まり） */
export function deviceLimitFrom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(20, value) : fallback;
}

export const DEFAULT_DISPLAY_LIMIT = 2;

/** 店舗ごとの契約の列（migration 00104 で足した分）。行が無い・列が無いときは ON・既定の台数 */
export interface DeviceContractColumns {
  registerEnabled: boolean;
  handyEnabled: boolean;
  displayLimit: number;
}

export const DEFAULT_CONTRACT_COLUMNS: DeviceContractColumns = {
  registerEnabled: true,
  handyEnabled: true,
  displayLimit: DEFAULT_DISPLAY_LIMIT,
};

export function contractColumnsFrom(
  row: { register_enabled?: unknown; handy_enabled?: unknown; display_limit?: unknown } | null | undefined
): DeviceContractColumns {
  if (!row) return DEFAULT_CONTRACT_COLUMNS;
  return {
    // 明示的に false のときだけ OFF（壊れた値・null は ON＝店を止めない）
    registerEnabled: row.register_enabled !== false,
    handyEnabled: row.handy_enabled !== false,
    displayLimit: deviceLimitFrom(row.display_limit, DEFAULT_DISPLAY_LIMIT),
  };
}

/**
 * 承認制をこの店舗・この種類の端末にかけるか。
 * - migration 00104 の前（ready = false）: かけない（今まで通り）
 * - レジ（iPad）: 台数を数えている店舗だけ（契約の行があって台数が 1 以上）。
 *   数えていない店舗の iPad は端末の記録（register_devices）が無いので、承認制にすると今使っている iPad が全部止まってしまう。
 *   運営が台数を決めて保存すると、その店舗の iPad は次に開いたときに承認待ち → 運営が承認、になる
 * - ハンディ・ディスプレイ: すべての店舗（今つながっている端末は承認済みなので止まらない）
 */
export function approvalApplies(type: DeviceType, input: { ready: boolean; countsRegister: boolean }): boolean {
  if (!input.ready) return false;
  if (type === 'register') return input.countsRegister;
  return true;
}

/** 同じ店舗・同じ種類で、承認待ちを何台まで置くか（いたずらで一覧を埋めさせない） */
export const MAX_PENDING_PER_TYPE = 5;

export type DeviceJoinDecision =
  /** 承認済みの端末。reactivate = 止まっていた（Wi-Fi 外の自動ログアウトなど）のを使い直す */
  | { kind: 'allow'; reactivate: boolean }
  /** 新しい端末を「承認待ち」で作る */
  | { kind: 'request' }
  /** 承認制をかけない（migration の前・数えない店舗）: 今まで通り、そのまま使える端末として作る */
  | { kind: 'create' }
  | { kind: 'pending' }
  | { kind: 'rejected' }
  | { kind: 'revoked' }
  | { kind: 'contract_off' }
  | { kind: 'limit'; limit: number }
  | { kind: 'too_many_pending' };

/**
 * 端末がログイン・接続しようとしたときの判定（レジのログイン・ハンディの QR・ディスプレイの QR で同じ決まり）。
 *   1. 契約 OFF の種類は、承認済みの端末でも使えない
 *   2. 分かっている端末（Cookie の鍵で見つけた・同じ店舗の行）は承認の状態どおり
 *      承認済みで止まっている端末は、使い直してよい種類（ハンディ）なら台数に空きがあれば使い直す
 *   3. 新しい端末は、台数に空きがあれば 承認待ち（承認制のとき）か そのまま作る（承認制でないとき）
 */
export function decideDeviceJoin(input: {
  contractEnabled: boolean;
  approvalRequired: boolean;
  known: { approval: ApprovalStatus; active: boolean } | null;
  /** この店舗・この種類で、使用中かつ承認済みの台数 */
  approvedActive: number;
  /** この店舗・この種類で、承認待ちの台数 */
  pending: number;
  /** 契約台数（null ＝ 数えない） */
  limit: number | null;
  /** 承認済みで止まっている端末を使い直してよいか（ハンディ: Wi-Fi 外の自動ログアウト・QR の作り直しのあと） */
  reactivatable: boolean;
}): DeviceJoinDecision {
  if (!input.contractEnabled) return { kind: 'contract_off' };
  const full = input.limit !== null && input.approvedActive >= input.limit;
  if (input.known) {
    switch (input.known.approval) {
      case 'pending':
        return { kind: 'pending' };
      case 'rejected':
        return { kind: 'rejected' };
      case 'revoked':
        return { kind: 'revoked' };
      case 'approved':
        if (input.known.active) return { kind: 'allow', reactivate: false };
        if (!input.reactivatable) return { kind: 'revoked' };
        if (full) return { kind: 'limit', limit: input.limit as number };
        return { kind: 'allow', reactivate: true };
    }
  }
  if (full) return { kind: 'limit', limit: input.limit as number };
  if (!input.approvalRequired) return { kind: 'create' };
  if (input.pending >= MAX_PENDING_PER_TYPE) return { kind: 'too_many_pending' };
  return { kind: 'request' };
}

/**
 * 運営が「承認」を押したときの判定。契約 OFF・台数いっぱいなら承認しない（理由を返す）。
 * すでに承認済みで使用中なら何もしない（noop）。
 */
export function decideApprove(input: {
  type: DeviceType;
  contractEnabled: boolean;
  current: ApprovalStatus;
  active: boolean;
  approvedActive: number;
  limit: number | null;
}): { ok: true; noop: boolean } | { ok: false; error: string } {
  const label = DEVICE_TYPE_LABELS[input.type];
  if (input.current === 'approved' && input.active) return { ok: true, noop: true };
  if (!input.contractEnabled) return { ok: false, error: `${label}の契約が OFF です。先に契約を ON にしてください` };
  if (input.limit !== null && input.approvedActive >= input.limit) {
    return { ok: false, error: `${label}の契約台数（${input.limit}台）に達しています。台数を増やすか、ほかの端末を解除してから承認してください` };
  }
  return { ok: true, noop: false };
}

/** 端末・店舗に出す文（現場の人が読む。理由と、だれに連絡するか） */
export const DEVICE_MESSAGE = {
  pending: 'この端末は TENPO ONE 運営の承認待ちです。承認されると使えます',
  /** ハンディ：承認されたあと、もう一度 QR を読むとそのまま入れる */
  pendingHandy: 'この端末は TENPO ONE 運営の承認待ちです。承認されると使えます（承認されたら、もう一度QRコードを読み取ってください）',
  /** レジ：承認されたあと、もう一度ログインする */
  pendingRegister: 'この端末は TENPO ONE 運営の承認待ちです。承認されると使えます（承認されたら、もう一度ログインしてください）',
  rejected: 'この端末は TENPO ONE 運営に承認されませんでした。使うときは TENPO ONE 運営へご連絡ください',
  revoked: 'この端末は TENPO ONE 運営で解除されています。もう一度使うときは TENPO ONE 運営へご連絡ください',
  tooManyPending: '承認待ちの端末が多すぎます。TENPO ONE 運営へご連絡ください',
  contractOff: {
    register: 'レジ（iPad）の契約が停止しています。TENPO ONE 運営へご連絡ください',
    handy: 'ハンディの契約が停止しています。TENPO ONE 運営へご連絡ください',
    display: 'ディスプレイ端末の契約が停止しています。TENPO ONE 運営へご連絡ください',
  } satisfies Record<DeviceType, string>,
  limit: {
    register: 'この店舗で使えるレジ端末の台数の上限です。台数の変更・使わない端末の解除は TENPO ONE 運営へご連絡ください',
    handy: 'この店舗で使えるハンディの台数の上限です。台数の変更・使わない端末の解除は TENPO ONE 運営へご連絡ください',
    display: 'この店舗で使えるディスプレイ端末の台数の上限です。台数の変更・使わない端末の解除は TENPO ONE 運営へご連絡ください',
  } satisfies Record<DeviceType, string>,
  /** 店舗の管理画面（一覧を見るだけ） */
  storeReadOnly: '端末の追加の承認・解除・台数は TENPO ONE 運営（コントロールセンター）で行います',
  /** 店舗の管理画面から解除しようとしたとき */
  storeRevokeRefused: '端末の解除は TENPO ONE 運営（コントロールセンター）で行います。TENPO ONE 運営へご連絡ください',
} as const;

/** 端末を止める判定 → 端末に出す文（allow / request / create は null） */
export function joinBlockMessage(type: DeviceType, d: DeviceJoinDecision): string | null {
  switch (d.kind) {
    case 'allow':
    case 'request':
    case 'create':
      return null;
    case 'pending':
      return type === 'handy' ? DEVICE_MESSAGE.pendingHandy : type === 'register' ? DEVICE_MESSAGE.pendingRegister : DEVICE_MESSAGE.pending;
    case 'rejected':
      return DEVICE_MESSAGE.rejected;
    case 'revoked':
      return DEVICE_MESSAGE.revoked;
    case 'contract_off':
      return DEVICE_MESSAGE.contractOff[type];
    case 'limit':
      return DEVICE_MESSAGE.limit[type];
    case 'too_many_pending':
      return DEVICE_MESSAGE.tooManyPending;
  }
}

/** ハンディの「端末の鍵」Cookie（httpOnly・400日）。承認待ちの端末と、自動ログアウトした承認済みの端末を見分ける */
export const HANDY_DEVICE_COOKIE = 'tenpo_handy_device';
export const HANDY_DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export function isDeviceToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{48}$/i.test(v);
}

/** 店舗の管理画面の一覧に出す状態（承認待ち・却下などは承認の状態、それ以外は使用中・解除済み） */
export function deviceStateLabel(input: { approval: ApprovalStatus; active: boolean }): string {
  if (input.approval !== 'approved') return APPROVAL_LABELS[input.approval];
  return input.active ? '使用中' : '解除済み';
}
