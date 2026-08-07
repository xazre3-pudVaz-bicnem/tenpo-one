import type { PermissionAction, Role } from '@/lib/permissions';
import { can } from '@/lib/permissions';

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

/** サイドバーのナビゲーション定義（権限で絞り込まれる） */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/app/dashboard', label: 'ダッシュボード', icon: 'home', permission: 'dashboard.view' },
    ],
  },
  {
    label: '予約',
    items: [
      { href: '/app/reservations', label: '予約台帳', icon: 'book', permission: 'reservations.view' },
      { href: '/app/reservations/list', label: '予約リスト', icon: 'list', permission: 'reservations.view' },
      { href: '/app/reservations/calendar', label: 'カレンダー', icon: 'calendar', permission: 'reservations.view' },
    ],
  },
  {
    label: '店舗運営',
    items: [
      { href: '/app/floor', label: 'フロアマップ', icon: 'grid', permission: 'tables.operate' },
      { href: '/app/pos', label: 'POSレジ', icon: 'pos', permission: 'pos.order' },
      { href: '/app/orders', label: '注文・取引履歴', icon: 'receipt', permission: 'pos.order' },
      { href: '/app/kitchen', label: 'キッチン', icon: 'clipboard', permission: 'pos.order' },
    ],
  },
  {
    label: '顧客',
    items: [
      { href: '/app/customers', label: '顧客管理', icon: 'users', permission: 'customers.view' },
    ],
  },
  {
    label: 'お金',
    items: [
      { href: '/app/cash', label: 'レジ締め・小口現金', icon: 'cash', permission: 'register.operate' },
      { href: '/app/expenses', label: '経費', icon: 'wallet', permission: 'cash.write' },
      { href: '/app/invoices', label: '請求書・書類', icon: 'file', permission: 'documents.write' },
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
    label: '労務',
    items: [
      { href: '/app/attendance', label: '勤怠・打刻', icon: 'clock', permission: 'attendance.punch' },
      { href: '/app/shifts', label: 'シフト', icon: 'calendarDays', permission: 'attendance.punch' },
      { href: '/app/payroll', label: '給与・歩合', icon: 'yen', permission: 'attendance.punch' },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '/app/reports', label: 'レポート', icon: 'chart', permission: 'reports.view' },
    ],
  },
  {
    label: '管理',
    items: [
      { href: '/app/staff', label: 'スタッフ', icon: 'userCog', permission: 'staff.manage' },
      { href: '/app/settings', label: '設定', icon: 'settings', permission: 'store.settings' },
    ],
  },
];

export function visibleNavGroups(role: Role | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || can(role, i.permission)),
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
