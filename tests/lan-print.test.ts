import { describe, expect, it } from 'vitest';
import {
  LAN_RAW_PORT,
  isLanRelayPrinter,
  parseDirectPrintConfig,
  parseLanTarget,
  printerDeliveryOf,
} from '@/lib/direct-print';
import { eposXmlToEscPos } from '@/lib/escpos';
import { drawerKickEpos, testPrintEpos } from '@/lib/epos-print';

// 2026-10-16 Ronnie「EPSON と SII RP-F10 を LAN で。Star・EPSON・RP-F10 をどの店でも選べるように」
describe('LAN のプリンター（iPad から送る）', () => {
  it('IPアドレス欄から送り先を読む（お店の中だけ・ポートは 9100）', () => {
    expect(parseLanTarget('192.168.1.50')).toEqual({ host: '192.168.1.50', port: LAN_RAW_PORT });
    expect(parseLanTarget(' 10.0.0.8:9101 ')).toEqual({ host: '10.0.0.8', port: 9101 });
    expect(parseLanTarget('172.20.3.4')).toEqual({ host: '172.20.3.4', port: 9100 });
    expect(parseLanTarget('rp-f10.local')).toEqual({ host: 'rp-f10.local', port: 9100 });
    expect(parseLanTarget('8.8.8.8')).toBeNull();
    expect(parseLanTarget('192.168.1.50:0')).toBeNull();
    expect(parseLanTarget('192.168.1.50:70000')).toBeNull();
    expect(parseLanTarget('192.168.1')).toBeNull();
    expect(parseLanTarget('')).toBeNull();
    expect(parseLanTarget(null)).toBeNull();
  });

  it('メーカーとつなぎ方で、印刷の届き方が決まる', () => {
    expect(printerDeliveryOf({ maker: 'Star', connection: 'lan' })).toBe('cloudprnt');
    expect(printerDeliveryOf({ maker: 'EPSON', connection: 'lan' })).toBe('sdp');
    expect(printerDeliveryOf({ maker: 'SII', connection: 'lan' })).toBe('ipad-lan');
    expect(printerDeliveryOf({ maker: 'その他', connection: 'wifi' })).toBe('ipad-lan');
    expect(printerDeliveryOf({ maker: 'SII', connection: 'bluetooth' })).toBe('ipad');
    expect(printerDeliveryOf({ maker: 'EPSON', connection: 'usb' })).toBe('ipad');
    expect(printerDeliveryOf({ maker: 'EPSON', connection: 'browser' })).toBe('browser');
    // メーカー未設定の古い行は今まで通り（CloudPRNT）
    expect(printerDeliveryOf({ maker: null, connection: 'lan' })).toBe('cloudprnt');
    expect(printerDeliveryOf({ maker: '', connection: null })).toBe('cloudprnt');
  });

  it('iPad から LAN で送れるのは Star 以外・Wi-Fi/有線LAN・お店の中の IP があるもの', () => {
    expect(isLanRelayPrinter({ maker: 'SII', connection: 'lan', ip: '192.168.0.30' })).toBe(true);
    expect(isLanRelayPrinter({ maker: 'EPSON', connection: 'wifi', ip: '192.168.0.31' })).toBe(true);
    expect(isLanRelayPrinter({ maker: 'SII', connection: 'lan', ip: null })).toBe(false);
    expect(isLanRelayPrinter({ maker: 'Star', connection: 'lan', ip: '192.168.0.32' })).toBe(false);
    expect(isLanRelayPrinter({ maker: 'SII', connection: 'bluetooth', ip: '192.168.0.33' })).toBe(false);
  });

  it('この iPad から送るプリンターを覚える（壊れた値・重複は捨てる）', () => {
    const c = parseDirectPrintConfig(JSON.stringify({ printerIds: [], lan: ['a', 'a', 'b', 3, ''] }));
    expect(c.lan).toEqual(['a', 'b']);
    expect(parseDirectPrintConfig(null).lan).toEqual([]);
    expect(parseDirectPrintConfig('{bad').lan).toEqual([]);
    expect(parseDirectPrintConfig(JSON.stringify({ printerIds: ['x'] })).lan).toEqual([]);
  });

  it('試し印刷・ドロアを ESC/POS にして送れる（LAN も Bluetooth と同じバイト列）', () => {
    const test = eposXmlToEscPos(testPrintEpos({ storeName: 'MEAT CROWN（LAN）', paperWidth: 80, issuedAt: '2026/10/16 18:00' }));
    expect(test.length).toBeGreaterThan(20);
    expect(test[0]).toBe(0x1b); // ESC @（初期化）
    const drawer = eposXmlToEscPos(drawerKickEpos(null));
    expect([...drawer].some((b, i) => b === 0x1b && drawer[i + 1] === 0x70)).toBe(true); // ESC p（ドロア）
  });
});
