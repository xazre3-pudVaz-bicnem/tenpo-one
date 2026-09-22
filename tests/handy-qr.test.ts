import { describe, it, expect } from 'vitest';
import {
  HANDY_OUTSIDE_GRACE_MS,
  addShopNetwork,
  decideOutside,
  handyQrFrom,
  handyQrUrl,
  isHandyQrToken,
  isShopNetwork,
  parseOutsideSince,
} from '@/lib/handy-qr';

const TOKEN = 'a'.repeat(48);

describe('iPhone用ハンディ（固定QR・お店のWi-Fiだけ・外に3分で自動ログアウト）', () => {
  it('設定の読み込み', () => {
    expect(handyQrFrom(null)).toEqual({ token: null, networks: [] });
    const s = handyQrFrom({ handyQr: { token: TOKEN.toUpperCase(), networks: [{ key: '203.0.113.5', label: 'レジ', addedAt: 'x' }, { bad: 1 }] } });
    expect(s.token).toBe(TOKEN);
    expect(s.networks).toHaveLength(1);
    expect(isHandyQrToken('xyz')).toBe(false);
  });

  it('お店の回線（IPv4 はそのまま、IPv6 は上位64ビット）', () => {
    let s = handyQrFrom(null);
    s = addShopNetwork(s, '203.0.113.5', 'レジ', 'now');
    s = addShopNetwork(s, '203.0.113.5', 'dup', 'now');
    s = addShopNetwork(s, '2001:db8:1:2::10', 'v6', 'now');
    expect(s.networks.map((n) => n.key)).toEqual(['203.0.113.5', '2001:0db8:0001:0002']);
    expect(isShopNetwork(s, '203.0.113.5')).toBe(true);
    expect(isShopNetwork(s, '::ffff:203.0.113.5')).toBe(true);
    expect(isShopNetwork(s, '2001:db8:1:2:aaaa::1')).toBe(true); // 同じ回線の別の端末
    expect(isShopNetwork(s, '198.51.100.7')).toBe(false); // スマホの回線
    expect(isShopNetwork(s, null)).toBe(false);
  });

  it('Wi-Fi の外に3分いたらログアウト', () => {
    const now = 1_800_000_000_000;
    expect(decideOutside({ guarded: false, inside: false, outsideSince: null, now })).toEqual({ kind: 'ok' });
    expect(decideOutside({ guarded: true, inside: true, outsideSince: now - 999_999, now })).toEqual({ kind: 'ok' });
    expect(decideOutside({ guarded: true, inside: false, outsideSince: null, now })).toEqual({ kind: 'outside', since: now, remainingMs: HANDY_OUTSIDE_GRACE_MS });
    expect(decideOutside({ guarded: true, inside: false, outsideSince: now - 60_000, now })).toMatchObject({ kind: 'outside', remainingMs: 120_000 });
    expect(decideOutside({ guarded: true, inside: false, outsideSince: now - HANDY_OUTSIDE_GRACE_MS, now })).toEqual({ kind: 'logout' });
    // 未来の時刻（改ざん）は今から数える
    expect(decideOutside({ guarded: true, inside: false, outsideSince: now + 60_000, now })).toMatchObject({ kind: 'outside', since: now });
    expect(parseOutsideSince('abc')).toBeNull();
    expect(parseOutsideSince(String(now))).toBe(now);
  });

  it('QR の URL（値は # 以降）', () => {
    expect(handyQrUrl('https://www.tenpo-one.com/', TOKEN)).toBe(`https://www.tenpo-one.com/handy-join#${TOKEN}`);
  });
});

describe('お店のWi-Fiの外からは注文・厨房送信を止める', () => {
  it('ハンディ端末の Server Action は requirePermission で Wi-Fi を確認する', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8');
    expect(src).toContain("ctx.isHandyDevice && (await headers()).get('next-action')");
    expect(src).toContain('assertHandyOnShopNetwork');
  });
});

describe('回線の形の確認', () => {
  it('IPv4 / IPv6 だけを受け付ける', async () => {
    const { isIpLiteral } = await import('@/lib/handy-qr');
    expect(isIpLiteral('113.33.158.194')).toBe(true);
    expect(isIpLiteral('2001:db8::1')).toBe(true);
    expect(isIpLiteral('999.1.1.1')).toBe(false);
    expect(isIpLiteral('<script>')).toBe(false);
    expect(isIpLiteral(12)).toBe(false);
  });
});
