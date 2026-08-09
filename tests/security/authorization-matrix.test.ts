import { describe, expect, it } from 'vitest';
import { can, ROLES, type Role, type PermissionAction } from '@/lib/permissions';

/**
 * 認可マトリクスの「否定側」を網羅検証する回帰テスト。
 * 権限を持つべきでないロールが機密操作を行えないことを保証する
 * （権限昇格・水平権限逸脱の防止。DB層のRLSと二重で守る前提の第一層）。
 */

const PAYROLL_ROLES: Role[] = ['org_owner', 'hq_admin', 'hq_accounting'];
const PAYROLL_VIEW_ROLES: Role[] = [...PAYROLL_ROLES, 'external_accountant'];

describe('認可マトリクス（否定側の網羅）', () => {
  it('給与の閲覧・機密情報アクセスは給与ロール以外に付与されない', () => {
    for (const role of ROLES) {
      const allowed = PAYROLL_VIEW_ROLES.includes(role);
      expect(can(role, 'payroll.view_all')).toBe(allowed);
    }
  });

  it('給与の管理（機密書込）は org_owner/hq_admin/hq_accounting のみ', () => {
    for (const role of ROLES) {
      expect(can(role, 'payroll.manage')).toBe(PAYROLL_ROLES.includes(role));
    }
  });

  it('組織設定はオーナー・本社管理者のみ（店長以下は不可）', () => {
    expect(can('store_manager', 'org.settings')).toBe(false);
    expect(can('area_manager', 'org.settings')).toBe(false);
    expect(can('assistant_manager', 'org.settings')).toBe(false);
    expect(can('staff', 'org.settings')).toBe(false);
    expect(can('part_time', 'org.settings')).toBe(false);
    expect(can('org_owner', 'org.settings')).toBe(true);
    expect(can('hq_admin', 'org.settings')).toBe(true);
  });

  it('一般スタッフ・アルバイトは機密系権限を一切持たない', () => {
    const sensitive: PermissionAction[] = ['payroll.manage', 'payroll.view_all', 'org.settings', 'staff.manage', 'csv.export'];
    for (const p of sensitive) {
      expect(can('staff', p)).toBe(false);
      expect(can('part_time', p)).toBe(false);
    }
  });

  it('外部税理士は閲覧・CSVのみでPOS/スタッフ管理は不可', () => {
    expect(can('external_accountant', 'staff.manage')).toBe(false);
    expect(can('external_accountant', 'org.settings')).toBe(false);
    expect(can('external_accountant', 'payroll.view_all')).toBe(true);
    expect(can('external_accountant', 'csv.export')).toBe(true);
  });

  it('未知ロールは全権限を拒否する（フェイルクローズ）', () => {
    const bogus = 'super_admin' as unknown as Role;
    expect(can(bogus, 'payroll.manage')).toBe(false);
    expect(can(bogus, 'org.settings')).toBe(false);
    expect(can(bogus, 'csv.export')).toBe(false);
  });
});
