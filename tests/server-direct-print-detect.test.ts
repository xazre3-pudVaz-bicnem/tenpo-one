import { describe, expect, it } from 'vitest';
import { looksLikeServerDirectPrint } from '@/lib/printing/server-direct-print-detect';

describe('looksLikeServerDirectPrint', () => {
  it('EPSON の GetRequest / SetResponse を見分ける', () => {
    expect(looksLikeServerDirectPrint('ConnectionType=GetRequest&ID=TM-m30III&Name=drink', 'application/x-www-form-urlencoded')).toBe(true);
    expect(looksLikeServerDirectPrint('ID=X&Name=Y&ConnectionType=SetResponse&ResponseFile=%3Cxml%2F%3E', null)).toBe(true);
    // Content-Type がフォームで ID= だけでも EPSON とみなす
    expect(looksLikeServerDirectPrint('ID=abc&Name=printer', 'application/x-www-form-urlencoded; charset=utf-8')).toBe(true);
  });

  it('Star CloudPRNT の JSON は EPSON ではない', () => {
    expect(looksLikeServerDirectPrint('{"printerMAC":"00:11:62:aa:bb:cc","statusCode":"200 OK"}', 'application/json')).toBe(false);
    expect(looksLikeServerDirectPrint('  {"printerMAC":"x"}', null)).toBe(false);
  });

  it('本文なし・ただの文字列は EPSON ではない', () => {
    expect(looksLikeServerDirectPrint('', 'application/x-www-form-urlencoded')).toBe(false);
    expect(looksLikeServerDirectPrint('hello', null)).toBe(false);
    expect(looksLikeServerDirectPrint('hello', 'application/x-www-form-urlencoded')).toBe(false);
  });
});
