import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { eposXmlToEscPos } from '@/lib/escpos';
import { drawerKickEpos, testPrintEpos } from '@/lib/epos-print';
import { bluetoothMakerOf, btFormatOf, parseDirectPrintConfig } from '@/lib/direct-print';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const hex = (b: Buffer) => b.toString('hex');

/**
 * 2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth（USB も）。チケットプリンターは LAN・Wi-Fi。
 * ESC/POS・Star・RP-F10 を選べるように」
 */
describe('ePOS-Print XML → ESC/POS（EPSON・SII RP-F10・そのほか）', () => {
  it('初期化・漢字モード（Shift_JIS）・中央寄せ・倍角・改行・カット', () => {
    const xml =
      '<epos-print xmlns="x"><text lang="ja"/><text align="center"/><text width="2" height="2"/>' +
      '<text>テスト&amp;&lt;1&gt;&#10;</text><feed line="3"/><cut type="feed"/></epos-print>';
    const b = eposXmlToEscPos(xml);
    expect(hex(b.subarray(0, 2))).toBe('1b40'); // ESC @
    expect(hex(b)).toContain('1c261c43011b7401'); // FS & / FS C 1 / ESC t 1
    expect(hex(b)).toContain('1b6101'); // 中央
    expect(hex(b)).toContain('1d2111'); // 2×2
    expect(hex(b)).toContain(hex(iconv.encode('テスト&<1>\n', 'Shift_JIS')));
    expect(hex(b)).toContain('1b6403'); // 3行送る
    expect(hex(b).endsWith('1d564200')).toBe(true); // カット
  });

  it('「¥」は全角（EPSON の桁合わせと同じ）', () => {
    const b = eposXmlToEscPos('<text>¥1,000&#10;</text>');
    expect(hex(b)).toContain(hex(iconv.encode('￥1,000\n', 'Shift_JIS')));
  });

  it('ドロア（コネクタ1・2）', () => {
    expect(hex(eposXmlToEscPos(drawerKickEpos(null)))).toContain('1b700032fa');
    expect(hex(eposXmlToEscPos(drawerKickEpos('[drawer: 2]')))).toContain('1b700132fa');
  });

  it('今の試し印刷もそのまま変換できる', () => {
    const b = eposXmlToEscPos(testPrintEpos({ storeName: 'FULL MOoN 五反田', paperWidth: 80, issuedAt: '2026/10/13 12:00' }));
    expect(b.length).toBeGreaterThan(50);
    expect(hex(b)).toContain(hex(iconv.encode('FULL MOoN 五反田', 'Shift_JIS')));
  });
});

describe('プリンターの種類を選ぶ（ESC/POS・Star・SII）', () => {
  it('メーカー名から種類', () => {
    expect(bluetoothMakerOf('Star')).toBe('star');
    expect(bluetoothMakerOf('EPSON')).toBe('epson');
    expect(bluetoothMakerOf('SII')).toBe('sii');
    expect(bluetoothMakerOf('その他')).toBe('escpos');
    expect(btFormatOf('star')).toBe('starprnt');
    expect(btFormatOf('sii')).toBe('escpos');
    expect(btFormatOf('epson')).toBe('escpos');
  });

  it('この iPad の Bluetooth・USB のつなぎ（壊れた値は捨てる）', () => {
    const c = parseDirectPrintConfig(
      JSON.stringify({
        printerIds: [],
        bluetooth: [
          { printerId: 'p1', deviceId: 'BT:00:11', deviceName: 'RP-F10', maker: 'sii', via: 'usb' },
          { printerId: 'p1', deviceId: 'dup', deviceName: 'x', maker: 'star' },
          { printerId: 'p2', deviceId: '', deviceName: 'x', maker: 'star' },
          { printerId: 'p3', deviceId: 'd', deviceName: 'x', maker: 'canon' },
        ],
      })
    );
    expect(c.bluetooth).toEqual([{ printerId: 'p1', deviceId: 'BT:00:11', deviceName: 'RP-F10', maker: 'sii', via: 'usb' }]);
  });

  it('管理画面で SII・ESC/POS と Bluetooth・USB を選べる', () => {
    const dlg = read('components/settings/printer-dialog.tsx');
    expect(dlg).toContain("const MAKER_OPTIONS = ['EPSON', 'Star', 'SII', 'その他'];");
    expect(dlg).toContain("{ value: 'bluetooth', label: 'Bluetooth（iPad とつなぐ・レシート）' }");
    expect(dlg).toContain("{ value: 'usb', label: 'USB（iPad とつなぐ・レシート）' }");
  });

  it('Bluetooth・USB は Star＝StarPRNT、それ以外＝ESC/POS を送る。アプリが無ければ何もしない', () => {
    const route = read('app/api/print/direct/route.ts');
    expect(route).toContain("if (body.action === 'next-bt')");
    expect(route).toContain('eposXmlToEscPos(job.payload.epos)');
    const agent = read('components/printing/direct-print-agent.tsx');
    expect(agent).toContain('const links = nativeBluetooth() ? (config.bluetooth ?? []) : [];');
  });
});
