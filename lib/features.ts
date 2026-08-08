/**
 * 機能フラグ（企業単位の機能ON/OFF）。
 * feature_flags テーブル: organization_id + flag_key + enabled。
 * 行が存在しない場合は既定で有効。enabled=false の行がある機能のみ無効化される。
 * 運営コンソール（/admin/feature-flags）から企業ごとに制御する。
 */

export const FEATURE_KEYS = [
  'reservations',
  'pos',
  'kds',
  'qr_order',
  'crm',
  'inventory',
  'costing',
  'accounting',
  'attendance',
  'payroll',
  'reports',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  reservations: '予約管理',
  pos: 'POSレジ・会計',
  kds: 'キッチンディスプレイ',
  qr_order: 'QRオーダー',
  crm: '顧客管理（CRM）',
  inventory: '仕入・発注・在庫',
  costing: 'レシピ・原価管理',
  accounting: '請求書・経費・小口現金',
  attendance: '勤怠・シフト',
  payroll: '給与・歩合',
  reports: 'レポート・分析',
};

/** ナビゲーションhref → 機能キーの対応（前方一致で判定） */
export const ROUTE_FEATURES: [string, FeatureKey][] = [
  ['/app/reservations', 'reservations'],
  ['/app/floor', 'pos'],
  ['/app/pos', 'pos'],
  ['/app/orders', 'pos'],
  ['/app/kitchen', 'kds'],
  ['/app/customers', 'crm'],
  ['/app/coupons', 'crm'],
  ['/app/cash', 'accounting'],
  ['/app/expenses', 'accounting'],
  ['/app/invoices', 'accounting'],
  ['/app/vendors', 'inventory'],
  ['/app/purchases', 'inventory'],
  ['/app/inventory', 'inventory'],
  ['/app/costing', 'costing'],
  ['/app/attendance', 'attendance'],
  ['/app/shifts', 'attendance'],
  ['/app/leave', 'attendance'],
  ['/app/employees', 'payroll'],
  ['/app/payroll', 'payroll'],
  ['/app/accounting', 'accounting'],
  ['/app/reconciliation', 'accounting'],
  ['/app/reports', 'reports'],
];

export function featureForRoute(href: string): FeatureKey | null {
  const hit = ROUTE_FEATURES.find(([prefix]) => href.startsWith(prefix));
  return hit ? hit[1] : null;
}

/** 無効化された機能キー集合に対する有効判定 */
export function isFeatureEnabled(disabled: ReadonlySet<string>, feature: FeatureKey): boolean {
  return !disabled.has(feature);
}
