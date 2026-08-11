/**
 * 店舗導入管理（CYPRESS運営）の定義層。
 * TENPO ONE本体の業務ロジックはここに置かない。ここは「導入状態の定義・判定」のみ。
 * - 環境（demo/test/pilot/production）
 * - 導入ステージの state machine
 * - 利用モジュール
 * - 導入チェックリスト（自動判定 auto / 人手確認 manual）
 * - Go Live 判定（有効モジュールに応じたCritical項目の充足）
 */

// ---------------------------------------------------------------
// 環境
// ---------------------------------------------------------------
export const ENVIRONMENTS = ['demo', 'test', 'pilot', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  demo: 'デモ',
  test: 'テスト',
  pilot: 'パイロット',
  production: '本番',
};

// ---------------------------------------------------------------
// 導入ステージ（state machine）
// ---------------------------------------------------------------
export const STAGES = [
  'draft',
  'onboarding',
  'configuration',
  'testing',
  'pilot',
  'ready',
  'live',
  'suspended',
  'cancelled',
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  draft: '下書き',
  onboarding: '導入準備',
  configuration: '設定中',
  testing: 'テスト中',
  pilot: 'パイロット運用',
  ready: '本番準備完了',
  live: '本番稼働中',
  suspended: '停止中',
  cancelled: '解約',
};

/** 許可されるステージ遷移（それ以外は不可。stateを自由文字で管理しない） */
export const STAGE_TRANSITIONS: Record<Stage, Stage[]> = {
  draft: ['onboarding', 'cancelled'],
  onboarding: ['configuration', 'suspended', 'cancelled'],
  configuration: ['testing', 'onboarding', 'suspended', 'cancelled'],
  testing: ['pilot', 'ready', 'configuration', 'suspended', 'cancelled'],
  pilot: ['ready', 'testing', 'suspended', 'cancelled'],
  ready: ['live', 'pilot', 'suspended', 'cancelled'],
  live: ['suspended', 'cancelled'],
  suspended: ['onboarding', 'configuration', 'testing', 'pilot', 'ready', 'live', 'cancelled'],
  cancelled: ['onboarding'], // 再開時はonboardingへ
};

export function canTransitionStage(from: Stage, to: Stage): boolean {
  return STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------
// 利用モジュール（Go Live判定・チェックリストの関連性に使用）
// ---------------------------------------------------------------
export const MODULES = [
  'reservations',
  'pos',
  'qr_order',
  'kds',
  'crm',
  'inventory',
  'accounting',
  'attendance',
  'payroll',
  'reports',
] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = {
  reservations: '予約',
  pos: 'POS',
  qr_order: 'モバイルオーダー(QR)',
  kds: 'KDS',
  crm: 'CRM',
  inventory: '在庫',
  accounting: '会計',
  attendance: '勤怠',
  payroll: '給与',
  reports: '分析',
};

// ---------------------------------------------------------------
// ハードウェア
// ---------------------------------------------------------------
export const HARDWARE_CATEGORIES = ['payment_terminal', 'printer', 'cash_drawer', 'kds'] as const;
export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];
export const HARDWARE_CATEGORY_LABELS: Record<HardwareCategory, string> = {
  payment_terminal: '決済端末',
  printer: 'プリンター',
  cash_drawer: 'キャッシュドロア',
  kds: 'KDS端末',
};
export const PAYMENT_PROVIDERS = ['Square', 'stera', 'USEN', 'AirPAY', 'PAYGATE', 'Other'] as const;
export const HARDWARE_STATUSES = ['planned', 'ordered', 'installed', 'active', 'inactive', 'removed'] as const;
export type HardwareStatus = (typeof HARDWARE_STATUSES)[number];
export const HARDWARE_STATUS_LABELS: Record<HardwareStatus, string> = {
  planned: '予定',
  ordered: '発注済',
  installed: '設置済',
  active: '稼働中',
  inactive: '停止',
  removed: '撤去',
};

// ---------------------------------------------------------------
// 導入チェックリスト
// kind='auto' はDB状態から自動判定（signalKey で signals を参照）。
// kind='manual' は人手確認（store_onboarding.checklist に保存）。
// module を指定した項目は、そのモジュールが enabled_modules に含まれる時だけ関連（relevant）。
// critical=true の関連項目が全て満たされると Go Live 可能。
// ---------------------------------------------------------------
export interface ChecklistItem {
  key: string;
  label: string;
  kind: 'auto' | 'manual';
  module?: Module;
  critical?: boolean;
}
export interface ChecklistGroup {
  key: string;
  label: string;
  items: ChecklistItem[];
}

export const CHECKLIST: ChecklistGroup[] = [
  {
    key: 'basic',
    label: '基本設定',
    items: [
      { key: 'org_created', label: 'organization作成', kind: 'auto', critical: true },
      { key: 'store_created', label: 'store作成', kind: 'auto', critical: true },
      { key: 'slug_set', label: 'slug設定', kind: 'auto', critical: true },
      { key: 'owner_account', label: 'Ownerアカウント', kind: 'auto', critical: true },
      { key: 'business_hours', label: '営業時間', kind: 'auto', critical: true },
      { key: 'holidays', label: '定休日の確認', kind: 'manual' },
    ],
  },
  {
    key: 'reservation',
    label: '予約',
    items: [
      { key: 'reservation_enabled', label: 'オンライン予約 受付ON', kind: 'auto', module: 'reservations' },
      { key: 'reservation_policy', label: '予約時間・滞在・締切の確認', kind: 'manual', module: 'reservations' },
      { key: 'cancel_policy', label: 'キャンセルポリシー', kind: 'auto', module: 'reservations' },
      { key: 'public_url', label: '公開予約URL', kind: 'auto', module: 'reservations' },
    ],
  },
  {
    key: 'store',
    label: '店舗',
    items: [
      { key: 'tables', label: 'テーブル', kind: 'auto', critical: true },
      { key: 'seat_count', label: '席数', kind: 'auto' },
      { key: 'table_qr', label: 'QRコード', kind: 'auto', module: 'qr_order' },
    ],
  },
  {
    key: 'menu',
    label: '商品',
    items: [
      { key: 'menu_items', label: 'メニュー', kind: 'auto', module: 'pos', critical: true },
      { key: 'categories', label: 'カテゴリ', kind: 'auto', module: 'pos' },
      { key: 'course', label: 'コース', kind: 'auto', module: 'reservations' },
      { key: 'pricing', label: '価格・売り切れ設定の確認', kind: 'manual', module: 'pos' },
    ],
  },
  {
    key: 'pos',
    label: 'POS',
    items: [
      { key: 'tax', label: '税設定', kind: 'auto', module: 'pos', critical: true },
      { key: 'register', label: 'レジ設定', kind: 'auto', module: 'pos', critical: true },
      { key: 'payment_methods', label: '支払方法の確認', kind: 'manual', module: 'pos' },
    ],
  },
  {
    key: 'hardware',
    label: 'Hardware',
    items: [
      { key: 'hw_payment_terminal', label: '決済端末', kind: 'auto', module: 'pos' },
      { key: 'hw_printer', label: 'プリンター', kind: 'auto' },
      { key: 'hw_cash_drawer', label: 'ドロア', kind: 'manual' },
      { key: 'hw_kds', label: 'KDS端末', kind: 'auto', module: 'kds' },
    ],
  },
  {
    key: 'operations',
    label: '業務',
    items: [
      { key: 'staff', label: 'スタッフ', kind: 'auto' },
      { key: 'roles', label: '権限設定の確認', kind: 'manual' },
      { key: 'attendance', label: '勤怠の確認', kind: 'manual', module: 'attendance' },
      { key: 'inventory', label: '在庫', kind: 'auto', module: 'inventory' },
      { key: 'accounting', label: '会計の確認', kind: 'manual', module: 'accounting' },
    ],
  },
  {
    key: 'golive',
    label: 'Go Live',
    items: [
      { key: 'e2e', label: 'E2Eテスト完了', kind: 'manual', critical: true },
      { key: 'security', label: 'セキュリティ確認', kind: 'manual', critical: true },
      { key: 'owner_confirm', label: '店舗オーナー確認', kind: 'manual', critical: true },
      { key: 'training', label: '操作説明済', kind: 'manual' },
      { key: 'go_live_approval', label: 'Go Live承認', kind: 'manual', critical: true },
    ],
  },
];

/** 全項目をフラットに */
export const ALL_CHECKLIST_ITEMS: ChecklistItem[] = CHECKLIST.flatMap((g) => g.items);

/** DB由来の自動判定シグナル（各auto項目 key → 充足有無） */
export type OnboardingSignals = Record<string, boolean>;

/** 手動チェックの保存形 */
export interface ManualCheckState {
  done: boolean;
  by?: string | null;
  at?: string | null;
}
export type ChecklistState = Record<string, ManualCheckState>;

export function isItemRelevant(item: ChecklistItem, enabledModules: string[]): boolean {
  return !item.module || enabledModules.includes(item.module);
}

/** 項目が満たされているか（auto=signals、manual=checklist） */
export function isItemDone(
  item: ChecklistItem,
  signals: OnboardingSignals,
  checklist: ChecklistState
): boolean {
  if (item.kind === 'auto') return !!signals[item.key];
  return !!checklist[item.key]?.done;
}

export interface OnboardingProgress {
  relevantTotal: number;
  relevantDone: number;
  percent: number;
}

/** 進捗率（関連する項目のうち満たされた割合） */
export function computeProgress(
  signals: OnboardingSignals,
  checklist: ChecklistState,
  enabledModules: string[]
): OnboardingProgress {
  const relevant = ALL_CHECKLIST_ITEMS.filter((i) => isItemRelevant(i, enabledModules));
  const done = relevant.filter((i) => isItemDone(i, signals, checklist)).length;
  const total = relevant.length;
  return { relevantTotal: total, relevantDone: done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export interface GoLiveResult {
  ready: boolean;
  blockers: { key: string; label: string }[];
}

/**
 * Go Live 判定: 有効モジュールに関連する Critical 項目が全て満たされているか。
 * 全機能導入は必須ではない（使わないモジュールのCriticalは対象外）。
 */
export function evaluateGoLive(
  signals: OnboardingSignals,
  checklist: ChecklistState,
  enabledModules: string[]
): GoLiveResult {
  const criticalRelevant = ALL_CHECKLIST_ITEMS.filter(
    (i) => i.critical && isItemRelevant(i, enabledModules)
  );
  const blockers = criticalRelevant
    .filter((i) => !isItemDone(i, signals, checklist))
    .map((i) => ({ key: i.key, label: i.label }));
  return { ready: blockers.length === 0, blockers };
}
