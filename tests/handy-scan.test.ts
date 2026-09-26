import { describe, expect, it } from 'vitest';
import { handyTokenFromScan } from '@/components/handy/handy-join-view';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';

describe('ハンディQRの読み取り値（2026-09-26 QRコードでログイン）', () => {
  it('QR の URL（…/handy-join#値）から値を取り出す', () => {
    expect(handyTokenFromScan(`https://www.tenpo-one.com/handy-join#${TOKEN}`)).toBe(TOKEN);
    expect(handyTokenFromScan(`https://www.tenpo-one.com/handy-join#${TOKEN.toUpperCase()}`)).toBe(TOKEN);
  });
  it('値だけでも可', () => {
    expect(handyTokenFromScan(` ${TOKEN} `)).toBe(TOKEN);
  });
  it('ほかの QR（テーブルQR・URL）は null', () => {
    expect(handyTokenFromScan('https://www.tenpo-one.com/q/abc')).toBeNull();
    expect(handyTokenFromScan('hello')).toBeNull();
    expect(handyTokenFromScan(`https://x/handy-join#${TOKEN.slice(0, 40)}`)).toBeNull();
  });
});
