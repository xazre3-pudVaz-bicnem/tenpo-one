import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRINTER_MODELS,
  deviceMatchesModel,
  discoverKindOf,
  makerSettingOf,
  printerModelById,
  printerModelOf,
} from '@/lib/printer-models';
import { bluetoothMakerOf, isLikelyPrinter } from '@/lib/direct-print';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** 2026-10-14 Ronnie「プリンター選択がいる。日本で人気の Bluetooth のプリンター（Star・EPSON・Brother など）を全部」 */
describe('プリンターの機種（Airレジのように選ぶ）', () => {
  it('Star・EPSON の人気機種は今すぐ使える。SII・Citizen・Brother は一覧に出すが準備中', () => {
    for (const id of ['star-mcp31', 'star-mcp21', 'star-mpop', 'epson-tm-m30iii', 'epson-tm-m30ii', 'epson-tm-m10']) {
      expect(printerModelById(id)?.ready, id).toBe(true);
    }
    for (const maker of ['sii', 'citizen', 'brother'] as const) {
      const list = PRINTER_MODELS.filter((m) => m.maker === maker);
      expect(list.length, maker).toBeGreaterThan(0);
      expect(list.every((m) => !m.ready)).toBe(true);
    }
    expect(new Set(PRINTER_MODELS.map((m) => m.id)).size).toBe(PRINTER_MODELS.length);
  });

  it('機種から、紙幅・送るデータ（Star＝StarPRNT、そのほか＝ESC/POS）・探し方が決まる', () => {
    const mcp31 = printerModelById('star-mcp31')!;
    const tm = printerModelById('epson-tm-m30iii')!;
    const other = printerModelById('escpos-ble-58')!;
    expect([mcp31.paper, tm.paper, other.paper]).toEqual([80, 80, 58]);
    expect(bluetoothMakerOf(makerSettingOf(mcp31))).toBe('star');
    expect(bluetoothMakerOf(makerSettingOf(tm))).toBe('epson');
    expect(bluetoothMakerOf(makerSettingOf(other))).toBe('escpos');
    expect([discoverKindOf(mcp31), discoverKindOf(tm), discoverKindOf(other)]).toEqual(['star', 'epson', 'all']);
    expect(printerModelOf('TM-m30III')?.id).toBe('epson-tm-m30iii');
    expect(printerModelOf('mc-print3')?.id).toBe('star-mcp31');
    expect(printerModelOf('Home Theater')).toBeNull();
  });

  it('探したとき、選んだメーカーのプリンターだけ出す', () => {
    const tm = printerModelById('epson-tm-m30iii')!;
    const found = [
      { name: 'TM-m30III（X5ZJ012345）', maker: 'epson', via: 'bluetooth' },
      { name: 'mC-Print3', maker: 'star', via: 'bluetooth' },
      { name: 'Home Theater', maker: 'escpos', via: 'bluetooth' },
    ];
    expect(found.filter((d) => deviceMatchesModel(tm, d) && isLikelyPrinter(d)).map((d) => d.name)).toEqual(['TM-m30III（X5ZJ012345）']);
    const other = printerModelById('escpos-ble-80')!;
    expect(found.filter((d) => deviceMatchesModel(other, d) && isLikelyPrinter(d))).toEqual([]);
  });

  it('アプリ：Star も EPSON と同じく Bluetooth（MFi）でそのまま送る・つながらないときは1回つなぎ直す', () => {
    const swift = read('ios/Shared/BluetoothPrinters.swift');
    expect(swift).toContain('static let protocols: [String: String] = ["com.epson.escpos": "epson", "jp.star-m.starpro": "star"]');
    expect(swift).toContain('EASession(accessory: job.accessory, forProtocol: job.proto)');
    expect(swift).toContain('guard let job = current, job.retried == 0, offset == 0 else { return finish(false, "connect") }');
    const plist = read('ios/App/Info.plist');
    expect(plist).toContain('<string>jp.star-m.starpro</string>');
    expect(plist).toContain('<string>com.epson.escpos</string>');
  });

  it('画面：機種を選ぶ・保存する（紙幅・会計レシート自動印刷・キャッシュドロア利用）。店長以上', () => {
    const panel = read('components/pos/device-printer-panel.tsx');
    for (const label of ['プリンター利用', 'プリンター', '接続', 'レシート紙幅', '会計レシート自動印刷', 'キャッシュドロア利用', '保存する']) {
      expect(panel).toContain(label);
    }
    const action = read('app/app/pos/device-printer-actions.ts');
    expect(action).toContain('export async function saveDeviceReceiptPrinterSettings');
    expect(action.match(/if \(!can\(ctx\.role, 'store\.settings'\)\)/g)?.length).toBe(2);
    expect(action).toContain('は準備中です');
  });
});
