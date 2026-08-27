import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { receiptToStarPrnt, drawerKickStarPrnt, testPrintStarPrnt } from '@/lib/starprnt';
import { baseReceipt as base } from './fixtures/receipt';

const ESC = 0x1b;
const GS = 0x1d;
const BACKSLASH = String.fromCharCode(0x5c); // CP932で ￥ として印字される位置

/** バイト列に指定のコマンド列が含まれるか。 */
const hasBytes = (buf: Buffer, bytes: number[]) => buf.includes(Buffer.from(bytes));
/** 既定エンコード(CP932)としてデコード。制御コマンドは化けるが本文確認には十分。 */
const asSjis = (buf: Buffer) => iconv.decode(buf, 'Shift_JIS');

describe('receiptToStarPrnt', () => {
  it('初期化で始まりカットで終わる', () => {
    const b = receiptToStarPrnt(base, { paperWidth: 80 });
    expect(b.subarray(0, 2)).toEqual(Buffer.from([ESC, 0x40]));
    expect(b.subarray(-3)).toEqual(Buffer.from([ESC, 0x64, 0x03]));
  });

  it('本文をCP932で出力する（実機mC-Print3はUTF-8を解釈しない）', () => {
    const b = receiptToStarPrnt(base, { paperWidth: 80 });
    // UTF-8で読むと化ける＝CP932で出ている証拠
    expect(b.toString('utf8')).not.toContain('シュラスコテーブル FOGO');
    const t = asSjis(b);
    expect(t).toContain('シュラスコテーブル FOGO');
    expect(t).toContain('シュラスコ食べ放題');
    expect(t).toContain('合計');
    expect(t).toContain('照会番号 ORD-1001');
  });

  it('整列・拡大・強調のコマンドを含む', () => {
    const b = receiptToStarPrnt(base);
    expect(hasBytes(b, [ESC, GS, 0x61, 0x01])).toBe(true); // 中央寄せ
    expect(hasBytes(b, [ESC, GS, 0x61, 0x00])).toBe(true); // 左寄せ
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x01])).toBe(true); // 拡大ON
    expect(hasBytes(b, [ESC, 0x45])).toBe(true); // 強調ON（合計行）
    expect(hasBytes(b, [ESC, 0x46])).toBe(true); // 強調OFF
  });

  it('キャンセル品は出力しない', () => {
    expect(asSjis(receiptToStarPrnt(base))).not.toContain('キャンセル品');
  });

  it('再発行・返金の見出しを出す', () => {
    const t = asSjis(receiptToStarPrnt({ ...base, isReissue: true, isRefundReceipt: true }));
    expect(t).toContain('※ 再発行');
    expect(t).toContain('※ 返金レシート');
  });

  it('用紙幅で桁数が変わる（58mm=32桁 / 80mm=48桁）', () => {
    expect(asSjis(receiptToStarPrnt(base, { paperWidth: 58 }))).toContain('-'.repeat(32));
    expect(asSjis(receiptToStarPrnt(base, { paperWidth: 80 }))).toContain('-'.repeat(48));
  });

  it('既定では ¥ を 0x5C で出す（半角1桁のまま ￥ と印字され桁揃えが崩れない）', () => {
    const t = asSjis(receiptToStarPrnt(base));
    expect(t).toContain(BACKSLASH + '11,300');
    expect(t).not.toContain('¥');
    expect(t).not.toContain('￥');
  });

  it('通貨記号の表現を切り替えられる', () => {
    expect(asSjis(receiptToStarPrnt(base, { currency: 'fullwidth' }))).toContain('￥11,300');
    // U+00A5 をそのまま出すのは UTF-8 を解釈するファーム向け
    const utf8 = receiptToStarPrnt(base, { currency: 'yen-sign', encoding: 'utf8' });
    expect(utf8.toString('utf8')).toContain('¥11,300');
  });

  it('encoding=utf8 ではUTF-8で出力する', () => {
    const b = receiptToStarPrnt(base, { encoding: 'utf8' });
    expect(b.toString('utf8')).toContain('シュラスコ食べ放題');
  });
});

describe('drawerKickStarPrnt', () => {
  it('Markup記法の番号を StarPRNT のドロア命令へ写像する', () => {
    expect(drawerKickStarPrnt('[drawer: 1]')).toEqual(Buffer.from([0x07]));
    expect(drawerKickStarPrnt('[drawer: 2]')).toEqual(Buffer.from([0x1a]));
  });

  it('未知の指定は1番にフォールバックする', () => {
    expect(drawerKickStarPrnt('')).toEqual(Buffer.from([0x07]));
    expect(drawerKickStarPrnt('nonsense')).toEqual(Buffer.from([0x07]));
  });
});

describe('testPrintStarPrnt', () => {
  it('店舗名と形式名を含み、カットで終わる', () => {
    const b = testPrintStarPrnt({ storeName: 'FOGO 新宿', paperWidth: 80, issuedAt: '2026/08/27 18:00' });
    const t = asSjis(b);
    expect(t).toContain('FOGO 新宿');
    expect(t).toContain('application/vnd.star.starprnt');
    expect(t).toContain('2026/08/27 18:00');
    expect(b.subarray(-3)).toEqual(Buffer.from([ESC, 0x64, 0x03]));
  });

  it('店舗名が空でも既定名で出力する', () => {
    expect(asSjis(testPrintStarPrnt({ storeName: '', issuedAt: 'now' }))).toContain('TENPO ONE');
  });
});
