import type { PermissionAction, Role } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';

export interface NavItem {
  href: string;
  label: string;
  /** 英語ラベル（日英併記） */
  en: string;
  icon: string; // lucide icon name（components/layout/nav-icons.tsx で解決）
  permission?: PermissionAction;
  /** 件数バッジの種類（layout 側で件数を渡す） */
  badge?: 'alerts';
  /** リンクではなく操作ボタンとして表示する */
  action?: 'drawer';
}

export interface NavGroup {
  label: string | null;
  en?: string;
  items: NavItem[];
}

/** 左メニュー最上段の大きなタイル（レジの主要動線） */
export interface NavTile {
  href: string;
  label: string;
  en: string;
  icon: string;
  permission?: PermissionAction;
  /** このタイルを選択中として扱うパス（前方一致） */
  match: string[];
}

export const NAV_TILES: NavTile[] = [
  {
    // 即会計（Quick pay）はこの中（テーブル一覧）の「テイクアウト」ボタンから。左メニューには出さない
    href: '/app/floor',
    label: 'オーダー・会計',
    en: 'Order & Pay',
    icon: 'pos',
    permission: 'tables.operate',
    match: ['/app/floor', '/app/pos'],
  },
  {
    href: '/app/reservations',
    label: '店舗台帳',
    en: 'Reservation',
    icon: 'calendar',
    permission: 'reservations.view',
    match: ['/app/reservations'],
  },
];

/**
 * 左メニューの定義（権限・機能フラグで絞り込まれる）。
 * 先頭グループはレジ業務の動線（D&DREAM レジ v32 の並び）。以降は業務ドメインごとの折りたたみグループ。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/app/dashboard', label: 'ホーム', en: 'Home', icon: 'home', permission: 'dashboard.view' },
      { href: '/app/handy', label: 'ハンディ', en: 'Handy', icon: 'monitor', permission: 'pos.order' },
      { href: '/app/orders', label: '伝票明細', en: 'Slips / Receipts', icon: 'receipt', permission: 'pos.order' },
      { href: '/app/cash', label: '入出金', en: 'Cash in / out', icon: 'wallet', permission: 'register.operate' },
      { href: '/app/expenses', label: '仕入・経費', en: 'Bills & payables', icon: 'file', permission: 'cash.write' },
      { href: '#drawer', label: 'ドロアオープン', en: 'Open drawer', icon: 'drawer', permission: 'pos.checkout', action: 'drawer' },
      { href: '/app/inventory', label: '在庫設定', en: 'Stock', icon: 'package', permission: 'inventory.view' },
      { href: '/app/cash/close', label: 'レジクローズ', en: 'Close register', icon: 'lock', permission: 'register.operate' },
      { href: '/app/scan', label: 'スキャン', en: 'Snap & file', icon: 'camera', permission: 'documents.write' },
      // レジの設定: 厨房伝票・品切れ・メニュー・QR・ハンディなど、レジで変える設定をまとめた画面（スタッフも開ける。変更は各権限）
      { href: '/app/pos/settings', label: 'レジの設定', en: 'Register settings', icon: 'gear', permission: 'pos.order' },
      { href: '/app/settings', label: '設定', en: 'Settings', icon: 'settings', permission: 'store.settings' },
      { href: '/app/notifications', label: 'アラート', en: 'Alerts', icon: 'bell', permission: 'dashboard.view', badge: 'alerts' },
    ],
  },
  {
    label: '店舗運営',
    en: 'Operations',
    items: [
      { href: '/app/kitchen', label: 'キッチン', en: 'Kitchen', icon: 'clipboard', permission: 'pos.order' },
      { href: '/app/customers', label: '顧客', en: 'Customers', icon: 'users', permission: 'customers.view' },
      { href: '/app/coupons', label: 'クーポン', en: 'Coupons', icon: 'ticket', permission: 'menu.manage' },
    ],
  },
  {
    label: '仕入・在庫',
    en: 'Purchasing',
    items: [
      { href: '/app/vendors', label: '仕入先', en: 'Vendors', icon: 'truck', permission: 'vendors.manage' },
      { href: '/app/purchases', label: '発注', en: 'Purchase orders', icon: 'clipboard', permission: 'vendors.manage' },
      { href: '/app/costing', label: '原価管理', en: 'Costing', icon: 'yen', permission: 'menu.manage' },
    ],
  },
  {
    label: '経理',
    en: 'Accounting',
    items: [
      { href: '/app/invoices', label: '請求書・書類', en: 'Invoices', icon: 'file', permission: 'documents.write' },
      { href: '/app/accounting', label: '仕訳', en: 'Journal', icon: 'book', permission: 'csv.export' },
      { href: '/app/accounting/ledger', label: '帳簿', en: 'Ledger', icon: 'list', permission: 'csv.export' },
      { href: '/app/accounting/statements', label: '財務レポート', en: 'Statements', icon: 'chart', permission: 'csv.export' },
      { href: '/app/accounting/banks', label: '銀行口座', en: 'Bank accounts', icon: 'bank', permission: 'csv.export' },
      { href: '/app/reconciliation', label: '照合', en: 'Reconciliation', icon: 'chart', permission: 'csv.export' },
    ],
  },
  {
    label: '労務',
    en: 'Labor',
    items: [
      { href: '/app/attendance', label: '勤怠・打刻', en: 'Attendance', icon: 'clock', permission: 'attendance.punch' },
      { href: '/app/shifts', label: 'シフト', en: 'Shifts', icon: 'calendarDays', permission: 'attendance.punch' },
      { href: '/app/employees', label: '従業員', en: 'Employees', icon: 'userCog', permission: 'staff.manage' },
      { href: '/app/leave', label: '有給休暇', en: 'Paid leave', icon: 'calendar', permission: 'attendance.punch' },
      { href: '/app/payroll', label: '給与・歩合', en: 'Payroll', icon: 'yen', permission: 'attendance.punch' },
    ],
  },
  {
    label: '経営',
    en: 'Management',
    items: [
      { href: '/app/reports', label: 'レポート', en: 'Reports', icon: 'chart', permission: 'reports.view' },
      { href: '/app/budgets', label: '予算管理', en: 'Budgets', icon: 'yen', permission: 'reports.view' },
      { href: '/app/daily-reports', label: '日報', en: 'Daily reports', icon: 'clipboard', permission: 'dashboard.view' },
    ],
  },
  {
    label: '店舗内共有',
    en: 'Team',
    items: [
      { href: '/app/tasks', label: 'タスク・引継ぎ', en: 'Tasks', icon: 'list', permission: 'dashboard.view' },
      { href: '/app/announcements', label: 'お知らせ', en: 'Notices', icon: 'mail', permission: 'dashboard.view' },
      { href: '/app/manuals', label: 'マニュアル', en: 'Manuals', icon: 'book', permission: 'dashboard.view' },
    ],
  },
  {
    label: '管理',
    en: 'Admin',
    items: [{ href: '/app/staff', label: 'スタッフ・権限', en: 'Staff', icon: 'userCog', permission: 'staff.manage' }],
  },
];

function allowed(item: { href: string; permission?: PermissionAction }, role: Role | null, disabled?: ReadonlySet<string>) {
  if (item.permission && !can(role, item.permission)) return false;
  if (disabled && !item.href.startsWith('#')) {
    const feature = featureForRoute(item.href);
    if (feature && disabled.has(feature)) return false;
  }
  return true;
}

export function visibleNavGroups(role: Role | null, disabledFeatures?: ReadonlySet<string>): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed(i, role, disabledFeatures)),
  })).filter((g) => g.items.length > 0);
}

export function visibleNavTiles(role: Role | null, disabledFeatures?: ReadonlySet<string>): NavTile[] {
  return NAV_TILES.filter((t) => allowed(t, role, disabledFeatures));
}

/** 上部バー中央の画面タイトル（ナビ以外の画面も含む）。長い前方一致を優先する。 */
const EXTRA_TITLES: { href: string; label: string; en: string }[] = [
  // POS はテーブル注文・テイクアウトの両方で使うため、画面タイトルはオーダー・会計に統一する
  { href: '/app/pos', label: 'オーダー・会計', en: 'Order & Pay' },
  { href: '/app/pos/receipt', label: 'レシート', en: 'Receipt' },
  { href: '/app/pos/settings', label: 'レジの設定', en: 'Register settings' },
  { href: '/app/pos/sold-out', label: '品切れ設定', en: 'Sold out' },
  { href: '/app/handy', label: 'ハンディ', en: 'Handy' },
  { href: '/app/onboarding', label: '初期設定', en: 'Setup' },
  { href: '/app/menu', label: 'メニュー', en: 'Menu' },
  { href: '/app/settings/clerks', label: 'POS担当者', en: 'Clerks' },
  { href: '/app/settings/options', label: 'オプション', en: 'Options' },
  { href: '/app/settings/plans', label: 'プラン', en: 'Plans' },
  { href: '/app/settings/categories', label: 'カテゴリ', en: 'Categories' },
  { href: '/app/settings/menu-bulk', label: 'メニュー一括編集', en: 'Bulk edit' },
  { href: '/app/settings/dynamic-pricing', label: 'ダイナミックプライシング', en: 'Dynamic pricing' },
  { href: '/app/settings/printers', label: 'レジ・プリンター', en: 'Registers & printers' },
  { href: '/app/settings/handy-qr', label: 'iPhoneハンディ', en: 'Handy QR' },
  { href: '/app/settings/payments', label: '決済・端末', en: 'Payments' },
  { href: '/app/settings/booking', label: '予約設定', en: 'Booking rules' },
  { href: '/app/settings/tables', label: 'テーブル・フロア', en: 'Tables' },
  { href: '/app/settings/menu', label: 'メニュー', en: 'Menu' },
  { href: '/app/settings/store', label: '店舗情報', en: 'Store' },
  { href: '/app/settings/company', label: '企業情報', en: 'Company' },
  { href: '/app/settings/hours', label: '営業時間・休業日', en: 'Hours' },
  { href: '/app/settings/tax', label: '税率', en: 'Tax' },
  { href: '/app/settings/accounts', label: '勘定科目', en: 'Accounts' },
  { href: '/app/settings/approvals', label: '承認ルール', en: 'Approvals' },
  { href: '/app/settings/loyalty', label: '会員・ポイント', en: 'Loyalty' },
  { href: '/app/settings/alerts', label: '異常検知の閾値', en: 'Alerts' },
  { href: '/app/settings/import', label: 'データ取込', en: 'Import' },
  { href: '/app/settings/integrations', label: '連携', en: 'Integrations' },
  { href: '/app/settings/audit', label: '監査ログ', en: 'Audit log' },
];

export function screenTitleFor(pathname: string): { label: string; en: string } | null {
  const candidates = [
    ...EXTRA_TITLES,
    ...NAV_TILES.map((t) => ({ href: t.href, label: t.label, en: t.en })),
    ...NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.action)),
  ];
  let best: { href: string; label: string; en: string } | null = null;
  for (const c of candidates) {
    if (pathname === c.href || pathname.startsWith(c.href + '/')) {
      if (!best || c.href.length > best.href.length) best = c;
    }
  }
  return best ? { label: best.label, en: best.en } : null;
}

/** スマホ下部ナビ（5項目まで） */
export const MOBILE_NAV: NavItem[] = [
  { href: '/app/dashboard', label: 'ホーム', en: 'Home', icon: 'home', permission: 'dashboard.view' },
  { href: '/app/reservations', label: '店舗台帳', en: 'Reservation', icon: 'calendar', permission: 'reservations.view' },
  // ハンディ（スマホでの注文取り）。iPad向けのオーダー画面とは別に、片手で使える画面を出す
  { href: '/app/handy', label: 'ハンディ', en: 'Handy', icon: 'pos', permission: 'pos.order' },
  { href: '/app/attendance', label: '勤怠', en: 'Attendance', icon: 'clock', permission: 'attendance.punch' },
  { href: '/app/menu', label: 'メニュー', en: 'Menu', icon: 'more' },
];

/**
 * レジ（iPad）下部ナビ（5項目まで）。
 * ハンディはスマホ用なので出さず（設定 > iPhoneハンディ から開く）、代わりに オーダー・会計 を置く。
 */
export const TABLET_NAV: NavItem[] = [
  { href: '/app/dashboard', label: 'ホーム', en: 'Home', icon: 'home', permission: 'dashboard.view' },
  { href: '/app/floor', label: 'オーダー・会計', en: 'Order & Pay', icon: 'pos', permission: 'tables.operate' },
  { href: '/app/reservations', label: '店舗台帳', en: 'Reservation', icon: 'calendar', permission: 'reservations.view' },
  { href: '/app/attendance', label: '勤怠', en: 'Attendance', icon: 'clock', permission: 'attendance.punch' },
  { href: '/app/menu', label: 'メニュー', en: 'Menu', icon: 'more' },
];
