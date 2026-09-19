import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  receiptToEposXml,
  ryoshushoToEposXml,
  orderSlipEposXml,
  kitchenTicketEposXml,
  testPrintEposXml,
  drawerKickEposXml,
  serverDirectPrintEnvelope,
  parseServerDirectPrintResult,
} from '@/lib/epos-print';
import { groupKitchenTickets, layoutKitchenTicket, type ClaimedKitchenItem } from '@/lib/kitchen-ticket';
import { baseReceipt as base } from './fixtures/receipt';

const NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

describe('escapeXml', () => {
  it('XMLで意味を持つ文字を無害化する', () => {
    expect(escapeXml('A&B<C>D"E\'F')).toBe('A&amp;B&lt;C&gt;D&quot;E&apos;F');
  });
});

describe('receiptToEposXml', () => {
  it('ePOS-Printの名前空間で始まり、カットで終わる', () => {
    const x = receiptToEposXml(base, { paperWidth: 80 });
    expect(x.startsWith(`<epos-print xmlns="${NS}">`)).toBe(true);
    expect(x.endsWith('</epos-print>')).toBe(true);
    expect(x).toContain('<cut type="feed"/>');
  });

  it('日本語をそのまま（UTF-8で）載せ、lang=ja を付ける', () => {
    const x = receiptToEposXml(base);
    expect(x).toContain('シュラスコテーブル FOGO');
    expect(x).toContain('lang="ja"');
  });

  it('店名は縦横2倍、合計は横2倍で出す', () => {
    const x = receiptToEposXml(base);
    expect(x).toContain('width="2" height="2"');
    expect(x).toMatch(/<text lang="ja" width="2">合計/);
  });

  it('キャンセル品は出力しない', () => {
    expect(receiptToEposXml(base)).not.toContain('キャンセル品');
  });

  it('商品名の & や < をエスケープする', () => {
    const x = receiptToEposXml({
      ...base,
      lines: [{ name: 'A&B<C>', quantity: 1, unitPrice: 100, lineTotal: 100, modifiers: [], cancelled: false }],
    });
    expect(x).toContain('A&amp;B&lt;C&gt;');
    expect(x).not.toContain('A&B<C>');
  });
});

describe('ryoshushoToEposXml', () => {
  it('見出しは「領収書」で、宛名と但し書きを反映する', () => {
    const x = ryoshushoToEposXml(base, { recipientName: '株式会社D&DREAM', purpose: '御飲食代として' });
    expect(x).toContain('領 収 書');
    expect(x).toContain('株式会社D&amp;DREAM 様');
    expect(x).toContain('但 御飲食代として');
    expect(x).toContain('上記正に領収いたしました');
  });

  it('未指定なら上様・お品代として', () => {
    const x = ryoshushoToEposXml(base);
    expect(x).toContain('上様 様');
    expect(x).toContain('但 お品代として');
  });

  it('領収額は netPaid、5万円以上で収入印紙欄', () => {
    expect(ryoshushoToEposXml({ ...base, refundTotal: 1300, netPaid: 10000 })).toContain('¥10,000');
    expect(ryoshushoToEposXml({ ...base, total: 50000, netPaid: 50000 })).toContain('収入印紙');
    expect(ryoshushoToEposXml(base)).not.toContain('収入印紙');
  });
});

const slip = {
  storeName: 'FULL MOoN 御茶ノ水',
  orderNo: '1001',
  tableName: 'T-3',
  guestCount: 4,
  clerkName: '山田',
  issuedAt: '2026/09/19 19:30',
  lines: [{ name: 'カレーセット', quantity: 2, unitPrice: 1200, lineTotal: 2400, modifiers: [{ name: 'ナン', price: 0 }] }],
  subtotal: 2182,
  taxTotal: 218,
  serviceCharge: 0,
  discount: 0,
  total: 2400,
};

describe('orderSlipEposXml', () => {
  it('注文内容と合計を出し、領収書ではないと明記する', () => {
    const x = orderSlipEposXml(slip, { paperWidth: 80 });
    expect(x).toContain('注文伝票');
    expect(x).toContain('カレーセット');
    expect(x).toContain('¥2,400');
    expect(x).toContain('※ これは領収書ではありません');
    expect(x).toContain('<cut type="feed"/>');
  });
});

describe('kitchenTicketEposXml', () => {
  const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
    order_id: 'o1',
    order_no: 5784,
    table_name: 'T10',
    guest_count: 2,
    clerk_name: 'Ronnie',
    item_name: 'チキンカレー',
    item_name_en: 'Chicken Curry',
    modifiers: [],
    memo: null,
    station: 'kitchen',
    delta: 1,
    ...over,
  });

  it('厨房伝票の英語・サイズ・整列をXMLへ写す', () => {
    const [t] = groupKitchenTickets([row({ delta: 2 })]);
    const x = kitchenTicketEposXml(
      layoutKitchenTicket(t, { title: 'キッチン', titleEn: 'KITCHEN', printedAt: '18:21', paperWidth: 80 })
    );
    expect(x).toContain('KITCHEN');
    expect(x).toContain('Chicken Curry  x2');
    expect(x).toContain('チキンカレー');
    // 卓名は縦横2倍・中央
    expect(x).toContain('<text lang="ja" align="center" width="2" height="2">T10');
    // 明細は縦2倍
    expect(x).toMatch(/<text lang="ja" align="left" height="2">Chicken Curry/);
  });
});

describe('testPrintEposXml / drawerKickEposXml', () => {
  it('テスト印刷は日本語確認行とカットを含む', () => {
    const x = testPrintEposXml({ storeName: 'FULL MOoN 御茶ノ水', paperWidth: 80, issuedAt: '2026/09/19 16:00' });
    expect(x).toContain('日本語テスト');
    expect(x).toContain('<cut type="feed"/>');
  });

  it('ドロアはpulseのみでカットしない（紙を無駄にしない）', () => {
    const x = drawerKickEposXml();
    expect(x).toContain('<pulse drawer="drawer_1" time="pulse_100"/>');
    expect(x).not.toContain('<cut');
  });
});

describe('serverDirectPrintEnvelope', () => {
  it('プリンターが要求する PrintRequestInfo で包む', () => {
    const x = serverDirectPrintEnvelope('<epos-print/>');
    expect(x.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(x).toContain('<PrintRequestInfo Version="1.00">');
    expect(x).toContain('<devid>local_printer</devid>');
    expect(x).toContain('<timeout>10000</timeout>');
    expect(x).toContain('<PrintData><epos-print/></PrintData>');
  });
});

describe('parseServerDirectPrintResult', () => {
  it('success="true" を成功と読む', () => {
    const xml =
      '<PrintResponseInfo Version="1.00"><response success="true" code="" status="251658262"/></PrintResponseInfo>';
    expect(parseServerDirectPrintResult(xml)).toEqual({ success: true, code: null });
  });

  it('失敗はコードを拾う', () => {
    const xml = '<PrintResponseInfo><response success="false" code="EPTR_COVER_OPEN"/></PrintResponseInfo>';
    expect(parseServerDirectPrintResult(xml)).toEqual({ success: false, code: 'EPTR_COVER_OPEN' });
  });

  it('空・解析不能は成功扱いにしない（印字していないジョブを済みにしないため）', () => {
    expect(parseServerDirectPrintResult(null)).toEqual({ success: false, code: null });
    expect(parseServerDirectPrintResult('')).toEqual({ success: false, code: null });
    expect(parseServerDirectPrintResult('garbage')).toEqual({ success: false, code: null });
  });
});
