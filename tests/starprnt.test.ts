import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  receiptToStarPrnt,
  ryoshushoToStarPrnt,
  orderSlipStarPrnt,
  drawerKickStarPrnt,
  testPrintStarPrnt,
} from '@/lib/starprnt';
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
    // 拡大は縦のみ2倍（ESC i n1=縦 n2=横 で 0=等倍）。横2倍にすると1行の桁数が半分になる
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x00])).toBe(true); // 拡大ON（縦のみ）
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x01])).toBe(false); // 縦横2倍は使わない
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

describe('ryoshushoToStarPrnt（領収書）', () => {
  it('初期化で始まりカットで終わり、見出しは「領収書」', () => {
    const b = ryoshushoToStarPrnt(base, { paperWidth: 80 });
    expect(b.subarray(0, 2)).toEqual(Buffer.from([ESC, 0x40]));
    expect(b.subarray(-3)).toEqual(Buffer.from([ESC, 0x64, 0x03]));
    const t = asSjis(b);
    expect(t).toContain('領 収 書');
    expect(t).toContain('上記正に領収いたしました');
    expect(t).not.toContain('照会番号');
  });

  it('宛名・但し書きは未指定なら既定値、指定すればその値', () => {
    expect(asSjis(ryoshushoToStarPrnt(base))).toContain('上様 様');
    const t = asSjis(ryoshushoToStarPrnt(base, { recipientName: '株式会社D&DREAM', purpose: '御飲食代として' }));
    expect(t).toContain('株式会社D&DREAM 様');
    expect(t).toContain('但 御飲食代として');
  });

  it('CP932で出力する（実機mC-Print3はUTF-8を解釈しない）', () => {
    const b = ryoshushoToStarPrnt(base);
    expect(b.toString('utf8')).not.toContain('領 収 書');
    expect(asSjis(b)).toContain('登録番号 T1234567890123');
  });

  it('拡大は縦のみで、見出しのあとは等倍に戻す（以降が大きいまま印字されない）', () => {
    const b = ryoshushoToStarPrnt(base, { paperWidth: 80 });
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x00])).toBe(true); // 縦2倍
    expect(hasBytes(b, [ESC, 0x69, 0x00, 0x00])).toBe(true); // 等倍に戻す
    expect(hasBytes(b, [ESC, 0x69, 0x02, 0x02])).toBe(false); // 3倍は使わない
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x01])).toBe(false); // 縦横2倍も使わない
  });
});

const slip = {
  storeName: 'シュラスコテーブル FOGO',
  orderNo: '1001',
  tableName: 'T-3',
  guestCount: 4,
  clerkName: '山田',
  issuedAt: '2026/09/19 19:30',
  lines: [
    { name: 'シュラスコ食べ放題', quantity: 2, unitPrice: 5000, lineTotal: 10000, modifiers: [] },
    { name: '生ビール', quantity: 3, unitPrice: 600, lineTotal: 1800, modifiers: [{ name: '大', price: 100 }] },
  ],
  subtotal: 10727,
  taxTotal: 1073,
  serviceCharge: 0,
  discount: 500,
  total: 11300,
};

describe('orderSlipStarPrnt（注文伝票）', () => {
  it('注文内容・合計を含み、領収書ではないと明記してカットする', () => {
    const b = orderSlipStarPrnt(slip, { paperWidth: 80 });
    expect(b.subarray(0, 2)).toEqual(Buffer.from([ESC, 0x40]));
    expect(b.subarray(-3)).toEqual(Buffer.from([ESC, 0x64, 0x03]));
    const t = asSjis(b);
    expect(t).toContain('お会計伝票');
    expect(t).toContain('T-3');
    expect(t).toContain('シュラスコ食べ放題');
    expect(t).toContain(`${BACKSLASH}11,300`);
    expect(t).toContain('※ これは領収書ではありません');
  });

  it('拡大は縦のみで、見出しのあとは等倍に戻す（以降が大きいまま印字されない）', () => {
    const b = orderSlipStarPrnt(slip, { paperWidth: 80 });
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x00])).toBe(true);
    expect(hasBytes(b, [ESC, 0x69, 0x00, 0x00])).toBe(true);
    expect(hasBytes(b, [ESC, 0x69, 0x02, 0x02])).toBe(false);
    expect(hasBytes(b, [ESC, 0x69, 0x01, 0x01])).toBe(false);
  });
});
