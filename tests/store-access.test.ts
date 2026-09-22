import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HANDY_LIMIT,
  DEFAULT_REGISTER_LIMIT,
  canAddHandyDevice,
  countsRegisterDevices,
  decideRegisterDevice,
  isAllowedNetwork,
  isRestricted,
  policyFrom,
  toNetwork,
} from '@/lib/store-access';

describe('店舗のアクセス制限（契約: お店の回線・レジ端末の台数）', () => {
  it('DBの行から読む（壊れた値は捨てる）', () => {
    expect(policyFrom(null)).toEqual({
      networks: [],
      registerLimit: DEFAULT_REGISTER_LIMIT,
      handyLimit: DEFAULT_HANDY_LIMIT,
      note: '',
    });
    const p = policyFrom({ networks: [{ key: '203.0.113.5', label: '店舗' }, { nope: 1 }], register_limit: 3, note: 'x' });
    expect(p.networks).toEqual([{ key: '203.0.113.5', label: '店舗' }]);
    expect(p.registerLimit).toBe(3);
    expect(policyFrom({ register_limit: -5 }).registerLimit).toBe(DEFAULT_REGISTER_LIMIT);
    expect(policyFrom({ handy_limit: 5 }).handyLimit).toBe(5);
    expect(policyFrom({ handy_limit: 99 }).handyLimit).toBe(20);
    expect(policyFrom({ handy_limit: 'x' }).handyLimit).toBe(DEFAULT_HANDY_LIMIT);
  });

  it('ハンディの台数（回線を登録した店舗だけ数える）', () => {
    const none = policyFrom(null);
    expect(canAddHandyDevice(none, 99)).toBe(true);
    const p = policyFrom({ networks: [{ key: '203.0.113.5', label: '' }], handy_limit: 2 });
    expect(canAddHandyDevice(p, 1)).toBe(true);
    expect(canAddHandyDevice(p, 2)).toBe(false);
  });

  it('入力したIPを回線に直す（IPv6 は上位64ビット）', () => {
    expect(toNetwork(' 203.0.113.5 ', '店舗光')).toEqual({ key: '203.0.113.5', label: '店舗光' });
    expect(toNetwork('2001:db8:1:2:aaaa::9', 'v6')?.key).toBe('2001:0db8:0001:0002');
    expect(toNetwork('999.9.9.9', '')).toBeNull();
    expect(toNetwork('drop table', '')).toBeNull();
  });

  it('回線が未登録なら制限なし、登録したら同じ回線だけ', () => {
    const none = policyFrom(null);
    expect(isRestricted(none)).toBe(false);
    expect(isAllowedNetwork(none, null)).toBe(true);
    const p = policyFrom({ networks: [{ key: '203.0.113.5', label: '' }, { key: '2001:0db8:0001:0002', label: '' }] });
    expect(isRestricted(p)).toBe(true);
    expect(isAllowedNetwork(p, '203.0.113.5')).toBe(true);
    expect(isAllowedNetwork(p, '2001:db8:1:2:ffff::7')).toBe(true);
    expect(isAllowedNetwork(p, '198.51.100.9')).toBe(false);
    expect(isAllowedNetwork(p, null)).toBe(false);
  });

  it('回線を登録していない店舗は台数を数えない（今まで通り）', () => {
    expect(countsRegisterDevices(policyFrom(null))).toBe(false);
    expect(countsRegisterDevices(policyFrom({ register_limit: 2 }))).toBe(false);
    expect(countsRegisterDevices(policyFrom({ networks: [{ key: '203.0.113.5', label: '' }] }))).toBe(true);
  });

  it('レジ端末の台数（契約で決めた数まで）', () => {
    const store = 's1';
    expect(decideRegisterDevice({ known: null, storeId: store, activeCount: 1, limit: 2 })).toEqual({ kind: 'register' });
    expect(decideRegisterDevice({ known: null, storeId: store, activeCount: 2, limit: 2 })).toEqual({ kind: 'limit', limit: 2 });
    expect(decideRegisterDevice({ known: { status: 'active', storeId: store }, storeId: store, activeCount: 2, limit: 2 })).toEqual({ kind: 'allowed' });
    expect(decideRegisterDevice({ known: { status: 'revoked', storeId: store }, storeId: store, activeCount: 0, limit: 2 })).toEqual({ kind: 'revoked' });
    // 別の店舗で使っていた端末は、空きがあれば登録し直す
    expect(decideRegisterDevice({ known: { status: 'active', storeId: 'other' }, storeId: store, activeCount: 0, limit: 2 })).toEqual({ kind: 'register' });
  });
});
