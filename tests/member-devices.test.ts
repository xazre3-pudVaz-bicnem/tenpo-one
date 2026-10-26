import { describe, expect, it } from 'vitest';
import { devicesByMember, registerStoreIdFromEmail } from '@/lib/member-devices';

const S = '5d128522-dde5-4450-95b8-8bdde36b6bc5';
describe('メンバーごとのログイン端末', () => {
  it('レジのアカウントのメールから店舗id', () => {
    expect(registerStoreIdFromEmail(`register-${S}@devices.tenpo-one.com`)).toBe(S);
    expect(registerStoreIdFromEmail('a@b.com')).toBeNull();
  });
  it('レジはその店のレジ端末（店の設定の名前）、ハンディ・ディスプレイは本人の端末。止めた端末は数えない', () => {
    const m = devicesByMember({
      members: [
        { profileId: 'reg', email: `register-${S}@devices.tenpo-one.com` },
        { profileId: 'p1', email: 'x@y.com' },
      ],
      register: [
        { id: 'd1', store_id: S, name: 'レジ端末', user_agent: 'iPad', last_seen_at: '2026-10-26T01:00:00Z', status: 'active' },
        { id: 'd2', store_id: S, name: 'レジ端末', user_agent: null, last_seen_at: null, status: 'revoked' },
      ],
      handy: [{ id: 'h1', profile_id: 'p1', name: 'ホールA', user_agent: 'iPhone', last_seen_at: null, status: 'active' }],
      display: [],
      registerSettings: new Map([[S, { d1: { label: 'レジ1', printerConfigId: null, nativePos: null, lanPrinterIds: [], wifiPrinterIds: [] } }]]),
    });
    expect(m.get('reg')?.map((d) => d.name)).toEqual(['レジ1']);
    expect(m.get('p1')?.map((d) => [d.kind, d.name])).toEqual([['handy', 'ホールA']]);
  });
});
