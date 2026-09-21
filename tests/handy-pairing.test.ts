import { describe, it, expect } from 'vitest';
import {
  clientIpFrom,
  generatePairingCode,
  handyDeviceEmail,
  hashPairingCode,
  isPairingCode,
  isSameNetwork,
  PAIRING_FAILURE_MESSAGE,
  pairingFailure,
} from '@/lib/handy-pairing';

describe('ペアリングコード', () => {
  it('48桁の16進で作る', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(48);
    expect(isPairingCode(code)).toBe(true);
  });

  it('毎回違う値になる', () => {
    expect(generatePairingCode()).not.toBe(generatePairingCode());
  });

  it('形式の違う値は受け付けない', () => {
    expect(isPairingCode('')).toBe(false);
    expect(isPairingCode('abc')).toBe(false);
    expect(isPairingCode('g'.repeat(48))).toBe(false);
    expect(isPairingCode('a'.repeat(47))).toBe(false);
    expect(isPairingCode('a'.repeat(49))).toBe(false);
  });

  it('保存するのはハッシュで、元のコードは復元できない', () => {
    const code = generatePairingCode();
    const hashed = hashPairingCode(code);
    expect(hashed).not.toBe(code);
    expect(hashed).toHaveLength(64);
    expect(hashPairingCode(code)).toBe(hashed); // 同じコードなら同じハッシュ
    expect(hashPairingCode(generatePairingCode())).not.toBe(hashed);
  });
});

describe('接続元IPの取り出し', () => {
  it('x-forwarded-for の先頭を使う（経由サーバーを足された場合も先頭が実際の接続元）', () => {
    expect(clientIpFrom({ forwardedFor: '203.0.113.10, 70.41.3.18' })).toBe('203.0.113.10');
    expect(clientIpFrom({ forwardedFor: ' 203.0.113.10 ' })).toBe('203.0.113.10');
  });

  it('無ければ x-real-ip を使う', () => {
    expect(clientIpFrom({ forwardedFor: null, realIp: '198.51.100.7' })).toBe('198.51.100.7');
  });

  it('どちらも無ければ null', () => {
    expect(clientIpFrom({})).toBeNull();
    expect(clientIpFrom({ forwardedFor: '', realIp: '' })).toBeNull();
  });
});

describe('同じWi-Fiかの判定', () => {
  it('同じ接続元IPなら同じ回線とみなす', () => {
    expect(isSameNetwork('203.0.113.10', '203.0.113.10')).toBe(true);
  });

  it('違うIPは別の回線（スマホの回線から登録させない）', () => {
    expect(isSameNetwork('203.0.113.10', '198.51.100.7')).toBe(false);
  });

  it('IPが分からないときは同じとみなさない（分からないまま通さない）', () => {
    expect(isSameNetwork(null, '203.0.113.10')).toBe(false);
    expect(isSameNetwork('203.0.113.10', null)).toBe(false);
    expect(isSameNetwork(null, null)).toBe(false);
  });
});

describe('ペアリングの可否', () => {
  const now = 1_700_000_000_000;
  const valid = { expiresAt: now + 60_000, usedAt: null, issuedIp: '203.0.113.10' };

  it('期限内・未使用・同じ回線なら通る', () => {
    expect(pairingFailure(valid, now, '203.0.113.10')).toBeNull();
  });

  it('QRが存在しない', () => {
    expect(pairingFailure(null, now, '203.0.113.10')).toBe('NOT_FOUND');
  });

  it('使用済みは断る（1回限り）', () => {
    expect(pairingFailure({ ...valid, usedAt: now - 1 }, now, '203.0.113.10')).toBe('USED');
  });

  it('期限切れは断る', () => {
    expect(pairingFailure({ ...valid, expiresAt: now }, now, '203.0.113.10')).toBe('EXPIRED');
    expect(pairingFailure({ ...valid, expiresAt: now - 1 }, now, '203.0.113.10')).toBe('EXPIRED');
  });

  it('違う回線からは断る', () => {
    expect(pairingFailure(valid, now, '198.51.100.7')).toBe('DIFFERENT_NETWORK');
    expect(pairingFailure(valid, now, null)).toBe('DIFFERENT_NETWORK');
  });

  it('使用済みと期限切れが重なったら使用済みを優先して伝える', () => {
    expect(pairingFailure({ ...valid, usedAt: now - 1, expiresAt: now - 1 }, now, '203.0.113.10')).toBe('USED');
  });

  it('断る理由は現場が対処できる日本語で返す', () => {
    expect(PAIRING_FAILURE_MESSAGE.DIFFERENT_NETWORK).toContain('Wi-Fi');
    expect(PAIRING_FAILURE_MESSAGE.EXPIRED).toContain('新しいQRコード');
    expect(PAIRING_FAILURE_MESSAGE.USED).toContain('使用済み');
  });
});

describe('端末アカウントのメールアドレス', () => {
  it('端末ごとに別のアドレスになる（1台ずつ解除できるように）', () => {
    expect(handyDeviceEmail('aaa')).not.toBe(handyDeviceEmail('bbb'));
    expect(handyDeviceEmail('aaa')).toMatch(/^handy-aaa@/);
  });
});
