import type { PermissionAction, Role } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import { featureForRoute } from '@/lib/features';

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name（components/layout/nav-icons.tsx で解決）
  permission?: PermissionAction;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * サイドバーのナビゲーション定義（権限・機能フラグで絞り込まれる）。
 * 完全統合型プラットフォーム方針（v0.4）: 店舗運営/仕入・在庫/経理/労務/経営 の
 * 業務ドメイン構成。グループはSidebar側で折りたたみ可能。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/app/dashboard', label: 'ダッシュボード', icon: 'home', permission: 'dashboard.view' },
    ],
  },
  {
    label: '店舗運営',
    items: [
      { href: '/app/reservations', label: '予約', icon: 'book', permission: 'reservations.view' },
      { href: '/app/floor', label: 'フロア', icon: 'grid', permission: 'tables.operate' },
      { href: '/app/pos', label: 'POSレジ', icon: 'pos', permission: 'pos.order' },
      { href: '/app/kitchen', label: 'キッチン', icon: 'clipboard', permission: 'pos.order' },
      { href: '/app/orders', label: '取引履歴', icon: 'receipt', permission: 'pos.order' },
      { href: '/app/customers', label: '顧客', icon: 'users', permission: 'customers.view' },
      { href: '/app/coupons', label: 'クーポン', icon: 'file', permission: 'menu.manage' },
    ],
  },
  {
    label: '仕入・在庫',
    items: [
      { href: '/app/vendors', label: '仕入先', icon: 'truck', permission: 'vendors.manage' },
      { href: '/app/purchases', label: '発注', icon: 'clipboard', permission: 'vendors.manage' },
      { href: '/app/inventory', label: '在庫', icon: 'package', permission: 'inventory.view' },
      { href: '/app/costing', label: '原価管理', icon: 'yen', permission: 'menu.manage' },
    ],
  },
  {
    label: '経理',
    items: [
      { href: '/app/cash', label: 'レジ・小口現金', icon: 'cash', permission: 'register.operate' },
      { href: '/app/expenses', label: '経費', icon: 'wallet', permission: 'cash.write' },
      { href: '/app/invoices', label: '請求書・書類', icon: 'file', permission: 'documents.write' },
      { href: '/app/accounting', label: '仕訳', icon: 'book', permission: 'csv.export' },
      { href: '/app/accounting/ledger', label: '帳簿', icon: 'list', permission: 'csv.export' },
      { href: '/app/accounting/statements', label: '財務レポート', icon: 'chart', permission: 'csv.export' },
      { href: '/app/accounting/banks', label: '銀行口座', icon: 'cash', permission: 'csv.export' },
    ],
  },
  {
    label: '労務',
    items: [
      { href: '/app/attendance', label: '勤怠・打刻', icon: 'clock', permission: 'attendance.punch' },
      { href: '/app/shifts', label: 'シフト', icon: 'calendarDays', permission: 'attendance.punch' },
      { href: '/app/employees', label: '従業員', icon: 'userCog', permission: 'staff.manage' },
      { href: '/app/leave', label: '有給休暇', icon: 'calendar', permission: 'attendance.punch' },
      { href: '/app/payroll', label: '給与・歩合', icon: 'yen', permission: 'attendance.punch' },
    ],
  },
  {
    label: '経営',
    items: [
      { href: '/app/reports', label: 'レポート', icon: 'chart', permission: 'reports.view' },
      { href: '/app/budgets', label: '予算管理', icon: 'yen', permission: 'reports.view' },
      { href: '/app/daily-reports', label: '日報', icon: 'clipboard', permission: 'dashboard.view' },
    ],
  },
  {
    label: '店舗内共有',
    items: [
      { href: '/app/tasks', label: 'タスク・引継ぎ', icon: 'list', permission: 'dashboard.view' },
      { href: '/app/announcements', label: 'お知らせ', icon: 'file', permission: 'dashboard.view' },
      { href: '/app/manuals', label: 'マニュアル', icon: 'book', permission: 'dashboard.view' },
    ],
  },
  {
    label: '管理',
    items: [
      { href: '/app/staff', label: 'スタッフ・権限', icon: 'userCog', permission: 'staff.manage' },
      { href: '/app/settings', label: '設定', icon: 'settings', permission: 'store.settings' },
    ],
  },
];

export function visibleNavGroups(
  role: Role | null,
  disabledFeatures?: ReadonlySet<string>
): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.permission && !can(role, i.permission)) return false;
      if (disabledFeatures) {
        const feature = featureForRoute(i.href);
        if (feature && disabledFeatures.has(feature)) return false;
      }
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}

/** スマホ下部ナビ（5項目まで） */
export const MOBILE_NAV: NavItem[] = [
  { href: '/app/dashboard', label: 'ホーム', icon: 'home', permission: 'dashboard.view' },
  { href: '/app/reservations', label: '予約', icon: 'book', permission: 'reservations.view' },
  { href: '/app/pos', label: 'POS', icon: 'pos', permission: 'pos.order' },
  { href: '/app/attendance', label: '勤怠', icon: 'clock', permission: 'attendance.punch' },
  { href: '/app/menu', label: 'メニュー', icon: 'more' },
];
