import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { eposXmlToEscPos } from '@/lib/escpos';
import { drawerKickEpos, kitchenTicketsEpos, orderSlipEposXml, receiptToEposXml, ryoshushoToEposXml, testPrintEpos } from '@/lib/epos-print';
import { baseReceipt } from './fixtures/receipt';
import {
  BT_MAKERS,
  BT_MAKER_SETTING,
  PRINTER_NAME_PATTERN,
  bluetoothMakerOf,
  btFormatOf,
  deviceReceiptPrinterName,
  isLikelyPrinter,
  parseDirectPrintConfig,
} from '@/lib/direct-print';

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

describe('EPSON をレジのレシートプリンターに（Bluetooth・USB でも同じ中身）', () => {
  // 2026-10-13 Ronnie「EPSON をレジのレシートでも使えるように。EPSON は Bluetooth でもつながる」
  const HANDLED = new Set(['epos-print', 'text', 'feed', 'cut', 'pulse']);
  const tags = (xml: string) => [...new Set([...xml.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1]))];
  const docs: [string, string][] = [
    ['レシート 80mm', receiptToEposXml(baseReceipt, { paperWidth: 80 })],
    ['レシート 58mm', receiptToEposXml(baseReceipt, { paperWidth: 58 })],
    ['領収書', ryoshushoToEposXml(baseReceipt, { paperWidth: 80, recipientName: '株式会社テスト', purpose: '飲食代として' })],
    [
      '会計伝票',
      orderSlipEposXml(
        {
          storeName: 'FULL MOoN 五反田',
          orderNo: '1',
          tableName: 'T-1',
          guestCount: 2,
          clerkName: 'Ronnie',
          issuedAt: '2026/10/13 19:30',
          lines: [{ name: 'カレーセット', quantity: 1, unitPrice: 1200, lineTotal: 1200, modifiers: [] }],
          subtotal: 1200,
          taxTotal: 120,
          serviceCharge: 0,
          discount: 0,
          total: 1320,
        },
        { paperWidth: 80 }
      ),
    ],
    ['厨房伝票（ブザー）', kitchenTicketsEpos([[{ text: 'T-1  ナン ×2', align: 'left', size: 'large' }]], { buzzer: 'drawer1' })],
    ['ドロア', drawerKickEpos(null)],
  ];

  it.each(docs)('%s：今の EPSON 用データの要素は全部 ESC/POS にできる', (_name, xml) => {
    expect(tags(xml).filter((t) => !HANDLED.has(t))).toEqual([]);
    const b = eposXmlToEscPos(xml);
    expect(hex(b.subarray(0, 2))).toBe('1b40');
    expect(b.length).toBeGreaterThan(6); // ドロアは ESC @ ＋ ESC p の7バイト
  });

  it('レシートの店名・合計が Shift_JIS で入り、最後に切る', () => {
    const b = eposXmlToEscPos(receiptToEposXml(baseReceipt, { paperWidth: 80 }));
    expect(hex(b)).toContain(hex(iconv.encode(baseReceipt.storeName, 'Shift_JIS')));
    expect(hex(b)).toContain('1d564200');
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

/** 2026-10-13 Ronnie「iPad アプリでプリンターの設定。レシートは Bluetooth から」（パソコンを使わず iPad だけで） */
describe('iPad からレシートプリンターを追加する', () => {
  it('入れるメーカー名は、読み直すと同じ種類になる（管理画面の選択肢と同じ言い方）', () => {
    for (const m of BT_MAKERS) expect(bluetoothMakerOf(BT_MAKER_SETTING[m])).toBe(m);
    expect(Object.values(BT_MAKER_SETTING)).toEqual(['Star', 'EPSON', 'SII', 'その他']);
  });

  it('名前：見つけた機械の名前（見えない文字は消す・60文字まで）、空ならメーカー＋レシート', () => {
    expect(deviceReceiptPrinterName('  TM-m30III\u0000 ', 'epson')).toBe('TM-m30III');
    expect(deviceReceiptPrinterName('mC-Print3   (BT)', 'star')).toBe('mC-Print3 (BT)');
    expect(deviceReceiptPrinterName('x'.repeat(80), 'sii')).toHaveLength(60);
    expect(deviceReceiptPrinterName('', 'epson')).toBe('EPSON レシート');
    expect(deviceReceiptPrinterName(null, 'escpos')).toBe('ESC/POS レシート');
  });

  it('iPad の設定に、管理画面で Bluetooth・USB として足しただけのプリンターも出す・追加は店長以上', () => {
    const page = read('app/app/pos/settings/page.tsx');
    expect(page).toContain(".or('cloudprnt_enabled.eq.true,connection_type.in.(bluetooth,usb)')");
    expect(page).toContain("canAdd={can(ctx.role, 'store.settings')}");
    const action = read('app/app/pos/device-printer-actions.ts');
    expect(action).toContain("if (!can(ctx.role, 'store.settings'))");
    // レシート機だけ・Bluetooth・USB だけ（厨房・Wi-Fi・LAN は管理画面）
    expect(action).toContain("if (existing.usage !== 'receipt')");
    expect(action).toContain("existing.connection_type !== 'bluetooth' && existing.connection_type !== 'usb'");
    expect(action).toContain("usage: 'receipt',");
    expect(action).toContain('cloudprnt_enabled: true,');
    // 選べるレシートの出し先は、印刷を受けるものだけ（今まで通り）
    const panel = read('components/pos/device-printer-panel.tsx');
    expect(panel).toContain("(p) => p.enabled && (p.usage === 'receipt' || p.billSlips) && (!isDeviceLink(p) || p.id === selected)");
  });
});

/** 2026-10-13 Ronnie「プリンターと使えるものだけ出す」（テレビ・イヤホン・Mac が出ていた） */
describe('「プリンターを探す」はプリンターだけ', () => {
  const ble = (name: string) => ({ name, maker: 'escpos', via: 'bluetooth' });

  it('テレビ・イヤホン・パソコン・名前の分からない機械は出さない', () => {
    for (const n of ['Home Theater', 'LE_BRAVIA Theatre Bar 8', 'Ronnies AirPods Pro 202607-', 'Ronnies MacBook Air', 'G185060', 'BP106A', 'Ronnies', 'Galaxy Buds', 'JBL Flip 5', 'Apple Watch']) {
      expect(isLikelyPrinter(ble(n)), n).toBe(false);
    }
  });

  it('プリンターの名前は出す', () => {
    for (const n of ['TM-m30III', 'mC-Print3', 'Star mC-Print3', 'RP-F10', 'SII RP-D10', 'MPT-II', 'PT-210', 'XP-P323B', 'TSP143', 'SM-L200', 'POS-58', 'BlueTooth Printer']) {
      expect(isLikelyPrinter(ble(n)), n).toBe(true);
    }
  });

  it('EPSON（iPad とペアリング）・Star・USB・アプリがプリンターと判断したものは名前に関係なく出す', () => {
    expect(isLikelyPrinter({ name: 'G185060', maker: 'epson', via: 'bluetooth' })).toBe(true);
    expect(isLikelyPrinter({ name: 'X', maker: 'star', via: 'bluetooth' })).toBe(true);
    expect(isLikelyPrinter({ name: 'X', maker: 'escpos', via: 'usb' })).toBe(true);
    expect(isLikelyPrinter({ name: 'G185060', maker: 'escpos', via: 'bluetooth', printer: '1' })).toBe(true);
  });

  it('アプリ（Swift）も同じ名前の決まり・Apple の機械を外す', () => {
    const swift = read('ios/Shared/BluetoothPrinters.swift');
    expect(swift).toContain(`pattern: #"${PRINTER_NAME_PATTERN.source}"#`);
    expect(swift).toContain('m[m.startIndex] == 0x4C');
    expect(swift).toContain('guard byService || Self.looksLikePrinter(name) else { return nil }');
    // プリンター以外も使う汎用のサービスでは出さない
    expect(swift).not.toMatch(/CBUUID\(string: "(FF00|FFE0|AE30|49535343-FE7D-4AE5-8FA9-9FAFD205E455)"\)/);
    const panel = read('components/pos/device-printer-panel.tsx');
    expect(panel).toContain('.filter((d) => deviceMatchesModel(model, d) && isLikelyPrinter(d))');
  });
});
