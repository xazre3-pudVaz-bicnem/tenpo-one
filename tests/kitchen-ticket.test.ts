import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  groupKitchenTickets,
  layoutKitchenTicket,
  type ClaimedKitchenItem,
} from '@/lib/kitchen-ticket';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';

const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
  order_id: 'o1',
  order_no: 5784,
  table_name: 'T10',
  guest_count: 2,
  clerk_name: 'Ronnie',
  item_name: 'チキンカレー',
  modifiers: [],
  memo: null,
  station: 'kitchen',
  delta: 1,
  ...over,
});

describe('groupKitchenTickets', () => {
  it('注文ごとに1枚にまとめる', () => {
    const t = groupKitchenTickets([
      row({ item_name: 'A' }),
      row({ item_name: 'B' }),
      row({ order_id: 'o2', order_no: 5785, table_name: 'T2', item_name: 'C' }),
    ]);
    expect(t).toHaveLength(2);
    expect(t[0].lines.map((l) => l.name)).toEqual(['A', 'B']);
    expect(t[1].tableName).toBe('T2');
  });

  it('差分0の行は除外する', () => {
    expect(groupKitchenTickets([row({ delta: 0 })])).toHaveLength(0);
  });

  it('取消を先頭に並べる', () => {
    const [t] = groupKitchenTickets([row({ item_name: '追加', delta: 2 }), row({ item_name: '取消', delta: -1 })]);
    expect(t.lines.map((l) => l.name)).toEqual(['取消', '追加']);
  });

  it('選択肢名を取り出す', () => {
    const [t] = groupKitchenTickets([row({ modifiers: [{ name: '大盛り' }, { name: '辛口' }] })]);
    expect(t.lines[0].modifiers).toEqual(['大盛り', '辛口']);
  });
});

describe('layoutKitchenTicket', () => {
  const opts = { title: 'キッチン', printedAt: '18:21', paperWidth: 80 as const };

  it('卓名を大きく、明細を縦倍で出す', () => {
    const [t] = groupKitchenTickets([row({ delta: 2 })]);
    const lines = layoutKitchenTicket(t, opts);
    expect(lines.find((l) => l.text === 'T10')?.size).toBe('large');
    // 厨房向けはローマ字を主・日本語を従で出す
    expect(lines.find((l) => l.text.startsWith('Chikinkaree'))).toMatchObject({ size: 'tall', text: 'Chikinkaree  x2' });
    expect(lines.some((l) => l.text === '   チキンカレー')).toBe(true);
    expect(lines.some((l) => l.text.includes('2名') && l.text.includes('担当 Ronnie'))).toBe(true);
  });

  it('取消は【取消】と絶対値で出す', () => {
    const [t] = groupKitchenTickets([row({ delta: -3 })]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('【取消/CANCEL】Chikinkaree  x3');
    expect(texts).toContain('*** 取消 ***');
  });

  it('追加と取消が混在する場合は取消見出しを出さない', () => {
    const [t] = groupKitchenTickets([row({ delta: -1 }), row({ item_name: 'ナン', delta: 1 })]);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text)).not.toContain('*** 取消 ***');
  });

  it('卓なしはテイクアウト表記', () => {
    const [t] = groupKitchenTickets([row({ table_name: null })]);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text)).toContain('テイクアウト');
  });

  it('選択肢とメモを明細の下に出す', () => {
    const [t] = groupKitchenTickets([row({ modifiers: [{ name: '大盛り' }], memo: 'パクチー抜き' })]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('   ・大盛り');
    expect(texts).toContain('   ※パクチー抜き');
  });
});

describe('kitchenTicketMarkup', () => {
  it('サイズ切替とカットを含み、角括弧をエスケープする', () => {
    const [t] = groupKitchenTickets([row({ item_name: '[限定]カレー' })]);
    const m = kitchenTicketMarkup(layoutKitchenTicket(t, { title: 'キッチン', printedAt: '18:21' }));
    expect(m).toContain('[magnify: width 2; height 2]');
    expect(m).toContain('[magnify: width 1; height 2]');
    expect(m).toContain('\\[限定\\]カレー');
    expect(m.trimEnd().endsWith('[cut: feed; partial]')).toBe(true);
  });
});

describe('kitchenTicketStarPrnt', () => {
  it('CP932で日本語を出し、初期化で始まりカットで終わる', () => {
    const [t] = groupKitchenTickets([row({})]);
    const buf = kitchenTicketStarPrnt(layoutKitchenTicket(t, { title: 'キッチン', printedAt: '18:21' }));
    expect([...buf.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...buf.subarray(buf.length - 3)]).toEqual([0x1b, 0x64, 0x03]);
    expect(buf.includes(iconv.encode('チキンカレー', 'Shift_JIS'))).toBe(true);
    // 縦倍（ESC i 1 0）を含む
    expect(buf.includes(Buffer.from([0x1b, 0x69, 0x01, 0x00]))).toBe(true);
  });
});

describe('ローマ字印字', () => {
  const opts = { title: 'キッチン', printedAt: '18:21', paperWidth: 80 as const };

  it('カナ欄の英語名をそのまま見出しに使う', () => {
    const [t] = groupKitchenTickets([row({ item_name: '本日のラッサム', item_name_kana: 'Rasam of the day' })]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('Rasam of the day  x1');
    expect(texts).toContain('   本日のラッサム');
  });

  it('漢字のみでカナが無い商品は日本語だけ出す（重複しない）', () => {
    const [t] = groupKitchenTickets([row({ item_name: '刺身盛合せ', item_name_kana: null })]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('刺身盛合せ  x1');
    expect(texts.filter((x) => x.includes('刺身盛合せ'))).toHaveLength(1);
  });
});
