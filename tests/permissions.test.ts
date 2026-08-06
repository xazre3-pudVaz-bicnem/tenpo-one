import { describe, expect, it } from 'vitest';
import { can, isHqRole } from '@/lib/permissions';

describe('権限マトリクス', () => {
  it('アルバイトはPOS操作可・値引き不可・給与管理不可', () => {
    expect(can('part_time', 'pos.order')).toBe(true);
    expect(can('part_time', 'pos.checkout')).toBe(true);
    expect(can('part_time', 'pos.discount')).toBe(false);
    expect(can('part_time', 'payroll.manage')).toBe(false);
    expect(can('part_time', 'customers.view')).toBe(false);
  });

  it('経理はPOS不可・現金承認可・給与閲覧可', () => {
    expect(can('hq_accounting', 'pos.order')).toBe(false);
    expect(can('hq_accounting', 'cash.approve')).toBe(true);
    expect(can('hq_accounting', 'payroll.view_all')).toBe(true);
    expect(can('hq_accounting', 'customers.view')).toBe(false);
  });

  it('店長は自店の運営・承認・スタッフ管理が可能', () => {
    expect(can('store_manager', 'pos.refund')).toBe(true);
    expect(can('store_manager', 'register.approve')).toBe(true);
    expect(can('store_manager', 'staff.manage')).toBe(true);
    expect(can('store_manager', 'org.settings')).toBe(false);
  });

  it('外部会計はレポート閲覧・CSVのみ', () => {
    expect(can('external_accountant', 'reports.view')).toBe(true);
    expect(can('external_accountant', 'csv.export')).toBe(true);
    expect(can('external_accountant', 'pos.order')).toBe(false);
    expect(can('external_accountant', 'reservations.write')).toBe(false);
  });

  it('本社ロール判定', () => {
    expect(isHqRole('org_owner')).toBe(true);
    expect(isHqRole('hq_accounting')).toBe(true);
    expect(isHqRole('store_manager')).toBe(false);
    expect(isHqRole(null)).toBe(false);
  });

  it('未ログイン（role=null）は全アクション不可', () => {
    expect(can(null, 'dashboard.view')).toBe(false);
    expect(can(undefined, 'pos.order')).toBe(false);
  });
});
