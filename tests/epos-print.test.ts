import { describe, it, expect } from 'vitest';
import {
  receiptToEposXml,
  ryoshushoToEposXml,
  orderSlipEposXml,
  drawerKickEpos,
  testPrintEpos,
  kitchenTicketEpos,
  serverDirectPrintResponse,
  parsePrintResultXml,
  escXml,
  eposCols,
  EPOS_NS,
} from '@/lib/epos-print';
import { groupKitchenTickets, layoutKitchenTicket, type ClaimedKitchenItem } from '@/lib/kitchen-ticket';
import { baseReceipt as base } from './fixtures/receipt';

/**
 * プリンタはXMLパーサで読むため、生成物が常に整形式であることを担保する。
 * 依存を増やさないよう、必要な範囲（タグの対応・テキスト中の未エスケープ文字）だけを検査する。
 */
function xmlErrors(xml: string): string[] {
  const errors: string[] = [];
  const stack: string[] = [];
  const body = xml.replace(/^<\?xml[^?]*\?>/, '');
  const token = /<\/?([A-Za-z][\w.-]*)((?:"[^"]*"|[^>"])*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(body))) {
    const [all, tag, attrs, text] = m;
    if (text != null) {
      // テキスト中に生の < & " があってはならない（実体参照になっているはず）
      if (/[<&](?!(amp|lt|gt|quot|apos|#\d+);)/.test(text)) errors.push(`未エスケープの文字: ${text.slice(0, 40)}`);
      continue;
    }
    if (all.startsWith('</')) {
      if (stack.pop() !== tag) errors.push(`閉じタグの不一致: ${all}`);
    } else if (!attrs.trimEnd().endsWith('/')) {
      stack.push(tag);
    }
    // 属性は name="value" の形だけを許す
    const rest = attrs.replace(/\s+[A-Za-z][\w:.-]*\s*=\s*"[^"]*"/g, '').replace(/\/$/, '').trim();
    if (rest) errors.push(`属性の書式が不正: ${all}`);
  }
  if (stack.length) errors.push(`閉じられていないタグ: ${stack.join(',')}`);
  return errors;
}

const expectWellFormed = (xml: string) => expect(xmlErrors(xml)).toEqual([]);

/** 単純なタグの中身を取り出す（テスト用）。 */
const tagText = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;

describe('receiptToEposXml', () => {
  it('整形式で、名前空間・主要な内容・カットを含む（80mm）', () => {
    const x = receiptToEposXml(base, { paperWidth: 80 });
    expectWellFormed(x);
    expect(x).toContain(`<epos-print xmlns="${EPOS_NS}">`);
    expect(x).toContain('<text lang="ja"/>');
    expect(x).toContain('シュラスコテーブル FOGO');
    expect(x).toContain('シュラスコ食べ放題');
    expect(x).toContain('¥11,300');
    expect(x).toContain('照会番号 ORD-1001');
    expect(x.trimEnd().endsWith('<cut type="feed"/></epos-print>')).toBe(true);
  });

  it('卓番号を出す（レジで卓を探せるように）', () => {
    expect(receiptToEposXml(base, { paperWidth: 80 })).toContain('卓 T-3');
    expect(receiptToEposXml({ ...base, tableName: null }, { paperWidth: 80 })).not.toContain('卓 ');
  });

  it('改行はLFの実体参照で表す（テキスト要素をまたがない）', () => {
    const x = receiptToEposXml(base, { paperWidth: 58 });
    expectWellFormed(x);
    expect(x).toContain('&#10;</text>');
    expect(x).not.toMatch(/<text>[^<]*\n/);
  });

  it('キャンセル品は出力しない', () => {
    expect(receiptToEposXml(base)).not.toContain('キャンセル品');
  });

  it('再発行・返金の見出しを出す', () => {
    const x = receiptToEposXml({ ...base, isReissue: true, isRefundReceipt: true });
    expect(x).toContain('※ 再発行');
    expect(x).toContain('※ 返金レシート');
  });

  it('XMLで意味を持つ文字を含む店名でも壊れない', () => {
    const x = receiptToEposXml({ ...base, storeName: 'A&B <C> "D"' });
    expectWellFormed(x);
    expect(x).toContain('A&amp;B &lt;C&gt; &quot;D&quot;');
  });

  it('制御文字は取り除く（プリンタがXMLとして読めなくなるため）', () => {
    const x = receiptToEposXml({ ...base, storeName: 'AB' });
    expectWellFormed(x);
    expect(x).toContain('AB');
  });
});

describe('ryoshushoToEposXml', () => {
  it('領収書の見出し・宛名・但し書き・領収額（netPaid）を含み、整形式', () => {
    const xml = ryoshushoToEposXml(base, { paperWidth: 80, recipientName: '株式会社テスト', purpose: '飲食代として' });
    expect(xmlErrors(xml)).toEqual([]);
    expect(xml).toContain('領 収 書');
    expect(xml).toContain('株式会社テスト 様');
    expect(xml).toContain('但 飲食代として');
    expect(xml).toContain('上記正に領収いたしました');
    expect(xml).toContain('<cut type="feed"/>');
  });

  it('宛名・但し書きが空なら「上様」「お品代として」を使う', () => {
    const xml = ryoshushoToEposXml(base, { paperWidth: 58 });
    expect(xml).toContain('上様 様');
    expect(xml).toContain('但 お品代として');
  });

  it('お客様に渡す紙なので英語の見出しを混ぜない', () => {
    const xml = ryoshushoToEposXml(base, { paperWidth: 80 });
    expect(xml).not.toMatch(/RECEIPT|Guests|Staff/);
  });
});

describe('orderSlipEposXml', () => {
  const slip = {
    storeName: 'FULL MOoN 御茶ノ水',
    orderNo: '123',
    tableName: 'T-3',
    guestCount: 2,
    clerkName: 'Ronnie',
    issuedAt: '2026/09/19 19:30',
    lines: [
      { name: 'カレーセット', quantity: 2, unitPrice: 1200, lineTotal: 2400, modifiers: [{ name: 'ナン', price: 0 }] },
      { name: 'ラッシー', quantity: 1, unitPrice: 400, lineTotal: 400, modifiers: [] },
    ],
    subtotal: 2800,
    taxTotal: 280,
    serviceCharge: 0,
    discount: 0,
    total: 3080,
  };

  it('注文伝票の見出し・卓・明細・合計・注意書きを含み、整形式', () => {
    const xml = orderSlipEposXml(slip, { paperWidth: 80 });
    expect(xmlErrors(xml)).toEqual([]);
    expect(xml).toContain('お会計伝票');
    expect(xml).toContain('T-3');
    expect(xml).toContain('No.123');
    expect(xml).toContain('カレーセット');
    expect(xml).toContain('+ ナン');
    expect(xml).toContain('2名');
    expect(xml).toContain('担当 Ronnie');
    expect(xml).toContain('これは領収書ではありません');
    expect(xml).toContain('<cut type="feed"/>');
  });

  it('卓なしはテイクアウト表記', () => {
    const xml = orderSlipEposXml({ ...slip, tableName: null, guestCount: null, clerkName: null }, { paperWidth: 58 });
    expect(xml).toContain('テイクアウト');
  });
});

describe('drawerKickEpos', () => {
  it('既定は2番ピン・オフラインでも開く強制モード', () => {
    const x = drawerKickEpos('');
    expectWellFormed(x);
    expect(x).toContain('force="true"');
    expect(x).toContain('<pulse drawer="drawer_1" time="pulse_100"/>');
  });

  it('Star用の [drawer: 2] 設定は5番ピンとして扱う', () => {
    expect(drawerKickEpos('[drawer: 2]')).toContain('drawer="drawer_2"');
  });
});

describe('testPrintEpos', () => {
  it('接続確認の内容を含む', () => {
    const x = testPrintEpos({ storeName: 'FOGO', paperWidth: 80, issuedAt: '2026/09/19 20:00' });
    expectWellFormed(x);
    expect(x).toContain('テスト印刷');
    expect(x).toContain('日本語テスト');
    expect(x).toContain('<cut type="feed"/>');
  });
});

describe('kitchenTicketEpos', () => {
  const row: ClaimedKitchenItem = {
    order_id: 'o1',
    order_no: 5784,
    table_name: 'T10',
    guest_count: 2,
    clerk_name: 'Ronnie',
    item_name: 'チキンカレー',
    modifiers: [{ name: '辛口' }],
    memo: null,
    station: 'kitchen',
    delta: 2,
  };

  it('卓名を縦2倍で出し、明細と選択肢を含む', () => {
    const [t] = groupKitchenTickets([row]);
    const x = kitchenTicketEpos(layoutKitchenTicket(t, { title: 'キッチン', printedAt: '18:21', paperWidth: 80 }));
    expectWellFormed(x);
    expect(x).toContain('<text width="1" height="2"/>'); // 卓名
    expect(x).not.toContain('width="2"'); // 横2倍は使わない
    expect(x).toContain('T10');
    expect(x).toContain('チキンカレー');
    expect(x).toContain('辛口');
  });
});

describe('serverDirectPrintResponse', () => {
  it('ジョブIDと印刷データを含む応答を組み立てる', () => {
    const xml = serverDirectPrintResponse({ id: 'job-1', xml: testPrintEpos({ storeName: 'F', issuedAt: 'now' }) });
    expectWellFormed(xml);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<PrintRequestInfo Version="2.00">');
    expect(tagText(xml, 'printjobid')).toBe('job-1');
    expect(tagText(xml, 'devid')).toBe('local_printer');
    expect(tagText(xml, 'timeout')).toBe('10000');
    expect(xml).toContain(`<PrintData><epos-print xmlns="${EPOS_NS}">`);
  });

  it('ジョブが無いときは空の応答を返す', () => {
    const xml = serverDirectPrintResponse(null);
    expectWellFormed(xml);
    expect(xml).toContain('<PrintRequestInfo Version="2.00"></PrintRequestInfo>');
    expect(xml).not.toContain('ePOSPrint');
  });
});

describe('parsePrintResultXml', () => {
  it('成功の結果からジョブIDを取り出す', () => {
    const r = parsePrintResultXml(
      '<PrintResponseInfo><ePOSPrint><Parameter><printjobid>job-1</printjobid></Parameter>' +
        '<PrintResponse><response success="true" code="" status="251658262" battery="0" /></PrintResponse></ePOSPrint></PrintResponseInfo>'
    );
    expect(r).toEqual({ jobId: 'job-1', success: true, code: null });
  });

  it('失敗の結果はエラー種別を返す', () => {
    const r = parsePrintResultXml(
      '<PrintResponseInfo><ePOSPrint><Parameter><printjobid>job-2</printjobid></Parameter>' +
        '<PrintResponse><response success="false" code="EPTR_COVER_OPEN" status="12" /></PrintResponse></ePOSPrint></PrintResponseInfo>'
    );
    expect(r).toEqual({ jobId: 'job-2', success: false, code: 'EPTR_COVER_OPEN' });
  });

  it('本文が空でも落ちない', () => {
    expect(parsePrintResultXml('')).toEqual({ jobId: null, success: false, code: null });
  });
});

describe('escXml', () => {
  it('XMLの特殊文字を実体参照にする', () => {
    expect(escXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('行の桁数', () => {
  /** 実機と同じ数え方の表示幅（EPSONは「¥」も全角で印字される）。 */
  const printedWidth = (s: string) =>
    [...s].reduce((n, ch) => {
      const c = ch.codePointAt(0) ?? 0;
      if (ch === '¥' || ch === '￥') return n + 2;
      const wide =
        (c >= 0x1100 && c <= 0x115f) ||
        (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6);
      return n + (wide ? 2 : 1);
    }, 0);

  /** XMLから印字される文字列の各行を取り出す。 */
  const printedLines = (xml: string) =>
    (xml.match(/<text>([^<]*)<\/text>/g) ?? [])
      .map((t) => t.replace(/<\/?text>/g, ''))
      .join('')
      .split('&#10;')
      .map((l) =>
        l
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      );

  const cases = [
    ['レシート', receiptToEposXml(base, { paperWidth: 80 })],
    ['領収書', ryoshushoToEposXml(base, { paperWidth: 80 })],
  ] as const;

  for (const [name, xml] of cases) {
    it(`${name}はどの行も桁数に収まる（右端で折り返さない）`, () => {
      const over = printedLines(xml).filter((l) => printedWidth(l) > eposCols(80));
      expect(over).toEqual([]);
    });
  }

  it('テスト印刷には桁位置を測る物差しが入る（実機の桁数を確かめるため）', () => {
    const xml = testPrintEpos({ storeName: 'FULL MOoN 御茶ノ水', paperWidth: 80, issuedAt: '2026/09/20 19:53' });
    const ruler = printedLines(xml).find((l) => l.startsWith('....+....1'));
    expect(ruler).toBeDefined();
    expect(ruler).toHaveLength(48); // 48桁ぶん。折り返した位置でその機種の桁数が分かる
    expect(ruler?.slice(0, 40)).toBe('....+....1....+....2....+....3....+....4'); // 10桁ごとに数字が入る
  });

  it('58mm指定では桁数が狭くなる', () => {
    expect(eposCols(58)).toBeLessThan(eposCols(80));
    const over = printedLines(receiptToEposXml(base, { paperWidth: 58 })).filter(
      (l) => printedWidth(l) > eposCols(58)
    );
    expect(over).toEqual([]);
  });
});
