import { describe, it, expect } from 'vitest';
import {
  receiptToEposXml,
  drawerKickEpos,
  testPrintEpos,
  kitchenTicketEpos,
  serverDirectPrintResponse,
  parsePrintResultXml,
  escXml,
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

  it('卓名を倍角で出し、明細と選択肢を含む', () => {
    const [t] = groupKitchenTickets([row]);
    const x = kitchenTicketEpos(layoutKitchenTicket(t, { title: 'キッチン', printedAt: '18:21', paperWidth: 80 }));
    expectWellFormed(x);
    expect(x).toContain('<text width="2" height="2"/>');
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
