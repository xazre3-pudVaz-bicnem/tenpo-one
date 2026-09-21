import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  DEFAULT_KITCHEN_TICKET_SPLIT,
  DEFAULT_KITCHEN_TICKET_TEXT_SIZE,
  KITCHEN_TICKET_TEXT_SIZE_LABELS,
  KITCHEN_TICKET_TEXT_SIZES,
  groupKitchenTickets,
  isKitchenTicketTextSize,
  kitchenTicketLanguageFrom,
  kitchenTicketSettingsFrom,
  kitchenTicketSplitFrom,
  kitchenTicketTextSizeFrom,
  layoutKitchenTicket,
  misroutedDrinkCategories,
  splitTicketByItem,
  ticketSlips,
  type ClaimedKitchenItem,
} from '@/lib/kitchen-ticket';
import { kitchenTicketMarkup, kitchenTicketsMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt, kitchenTicketsStarPrnt } from '@/lib/starprnt';

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
  const opts = { title: 'キッチン', titleEn: 'KITCHEN', printedAt: '18:21', paperWidth: 80 as const };

  it('卓名を縦倍で出し、明細は等倍で出す（横2倍は使わない）', () => {
    const [t] = groupKitchenTickets([row({ delta: 2 })]);
    const lines = layoutKitchenTicket(t, opts);
    expect(lines.find((l) => l.text === 'T10')?.size).toBe('tall');
    expect(lines.some((l) => l.size === 'large')).toBe(false);
    // 厨房向けは英語を主・日本語を従で出す
    expect(lines.find((l) => l.text.startsWith('Chikinkaree'))).toMatchObject({ size: 'normal', text: 'Chikinkaree  x2' });
    expect(lines.some((l) => l.text === '   チキンカレー')).toBe(true);
    // 見出し・人数・担当も英語で読める
    expect(lines.map((l) => l.text)).toContain('KITCHEN');
    expect(lines.map((l) => l.text)).toContain('キッチン');
    expect(lines.some((l) => l.text.includes('Guests 2') && l.text.includes('Staff Ronnie'))).toBe(true);
  });

  it('取消は CANCEL と絶対値で出す', () => {
    const [t] = groupKitchenTickets([row({ delta: -3 })]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    // 取消の印は商品名と別の行（大きい文字で商品名の途中から折り返さないように）
    const at = texts.indexOf('[CANCEL / 取消]');
    expect(at).toBeGreaterThan(-1);
    expect(texts[at + 1]).toBe('Chikinkaree  x3');
    expect(texts).toContain('*** CANCEL / 取消 ***');
  });

  it('追加と取消が混在する場合は取消見出しを出さない', () => {
    const [t] = groupKitchenTickets([row({ delta: -1 }), row({ item_name: 'ナン', delta: 1 })]);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text)).not.toContain('*** CANCEL / 取消 ***');
  });

  it('卓なしはテイクアウト表記（英語併記）', () => {
    const [t] = groupKitchenTickets([row({ table_name: null })]);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text)).toContain('TAKEOUT / テイクアウト');
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
    expect(m.startsWith('[bold: on]\n')).toBe(true); // 本文全体を太字
    expect(m).toContain('[magnify: width 1; height 2]'); // 卓名は縦2倍
    expect(m).not.toContain('width 2'); // 横2倍は使わない
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

describe('英語印字', () => {
  const opts = { title: 'キッチン', titleEn: 'KITCHEN', printedAt: '18:21', paperWidth: 80 as const };

  it('設定した英語名（name_en）を最優先で見出しに使う', () => {
    const [t] = groupKitchenTickets([
      row({ item_name: 'チキンカレー', item_name_kana: 'チキンカレー', item_name_en: 'Chicken Curry' }),
    ]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('Chicken Curry  x1');
    expect(texts).toContain('   チキンカレー');
    expect(texts).not.toContain('Chikinkaree  x1');
  });

  it('英語名が無ければカナ欄の英語をそのまま使う', () => {
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

describe('セットの選択肢（カレー・ナン/ご飯など）', () => {
  const opts = { title: 'キッチン', titleEn: 'KITCHEN', printedAt: '18:21', paperWidth: 80 as const };

  it('選択肢に英語名があれば英語で印字する（厨房が作るものそのもののため）', () => {
    const [t] = groupKitchenTickets([
      row({
        item_name: 'カレーセット',
        item_name_en: 'Curry Set',
        modifiers: [
          { name: 'バターチキン', name_en: 'Butter Chicken' },
          { name: 'ナン', name_en: 'Naan' },
        ],
      }),
    ]);
    const texts = layoutKitchenTicket(t, opts).map((l) => l.text);
    expect(texts).toContain('Curry Set  x1');
    expect(texts).toContain('   ・Butter Chicken');
    expect(texts).toContain('   ・Naan');
  });

  it('選択肢に英語名が無ければ日本語のまま出す', () => {
    const [t] = groupKitchenTickets([row({ modifiers: [{ name: '大盛り' }] })]);
    expect(layoutKitchenTicket(t, opts).map((l) => l.text)).toContain('   ・大盛り');
  });
});

describe('商品の種類ごとの伝票（2026-09-21 店舗要望）', () => {
  const opts = { title: 'ドリンク 伝票', titleEn: 'DRINK', printedAt: '19:05', paperWidth: 80 as const };

  it('既定は「種類ごと」。設定で「まとめて」にできる', () => {
    expect(DEFAULT_KITCHEN_TICKET_SPLIT).toBe('item');
    expect(kitchenTicketSplitFrom(null)).toBe('item');
    expect(kitchenTicketSplitFrom({})).toBe('item');
    expect(kitchenTicketSplitFrom({ kitchenTicket: { split: 'order' } })).toBe('order');
    expect(kitchenTicketSplitFrom({ kitchenTicket: { split: 'xxx' } })).toBe('item');
    expect(kitchenTicketSplitFrom({ drawer: { autoOpenOnCash: true } })).toBe('item');
  });

  it('レジで1個ずつタップした同じ商品は数量を足して1行にする', () => {
    const [t] = groupKitchenTickets([
      row({ item_name: '生ビール' }),
      row({ item_name: '生ビール' }),
      row({ item_name: '生ビール' }),
      row({ item_name: 'ハイボール' }),
    ]);
    expect(t.lines.map((l) => [l.name, l.delta])).toEqual([
      ['生ビール', 3],
      ['ハイボール', 1],
    ]);
  });

  it('選択肢・メモが違えば別の行、追加と取消も別の行', () => {
    const [t] = groupKitchenTickets([
      row({ item_name: 'カレー', modifiers: [{ name: '辛口' }] }),
      row({ item_name: 'カレー', modifiers: [{ name: '甘口' }] }),
      row({ item_name: 'カレー', modifiers: [{ name: '辛口' }], memo: 'パクチー抜き' }),
      row({ item_name: 'カレー', modifiers: [{ name: '辛口' }], delta: -1 }),
    ]);
    expect(t.lines).toHaveLength(4);
    expect(t.lines[0].delta).toBe(-1); // 取消を先頭に
  });

  it('1商品1枚に分け、何枚目かを付ける', () => {
    const [t] = groupKitchenTickets([row({ item_name: 'A' }), row({ item_name: 'B' }), row({ item_name: 'C' })]);
    const slips = splitTicketByItem(t);
    expect(slips).toHaveLength(3);
    expect(slips.map((s) => s.lines.map((l) => l.name))).toEqual([['A'], ['B'], ['C']]);
    expect(slips[1].part).toEqual({ index: 2, total: 3 });
    // 卓名・伝票番号はどの紙にも出る
    expect(slips.every((s) => s.tableName === 'T10' && s.orderNo === '5784')).toBe(true);
  });

  it('「まとめて」は分けない', () => {
    const [t] = groupKitchenTickets([row({ item_name: 'A' }), row({ item_name: 'B' })]);
    expect(ticketSlips(t, 'order')).toHaveLength(1);
    expect(ticketSlips(t, 'item')).toHaveLength(2);
  });

  it('分けた伝票は「(2/3)」を出し、商品名を縦2倍で出す。1枚だけなら(1/1)は出さない', () => {
    const [t] = groupKitchenTickets([row({ item_name: 'A' }), row({ item_name: 'B' }), row({ item_name: 'C' })]);
    const lines = layoutKitchenTicket(splitTicketByItem(t)[1], opts);
    expect(lines.some((l) => l.text.startsWith('No.5784  (2/3)'))).toBe(true);
    expect(lines.find((l) => l.text.startsWith('B  x1'))?.size).toBe('tall');

    const [single] = groupKitchenTickets([row({ item_name: 'D' })]);
    const one = layoutKitchenTicket(splitTicketByItem(single)[0], opts);
    expect(one.some((l) => l.text.includes('(1/1)'))).toBe(false);
    expect(one.find((l) => l.text.startsWith('D  x1'))?.size).toBe('tall');
  });

  it('1回の注文ぶんを1つのジョブにし、1枚ごとに紙を切る（Markup / StarPRNT）', () => {
    const [t] = groupKitchenTickets([row({ item_name: 'A' }), row({ item_name: 'B' }), row({ item_name: 'C' })]);
    const slips = splitTicketByItem(t).map((s) => layoutKitchenTicket(s, opts));
    const markup = kitchenTicketsMarkup(slips);
    expect(markup.match(/\[cut: feed; partial\]/g)).toHaveLength(3);
    const buf = kitchenTicketsStarPrnt(slips);
    let cuts = 0;
    for (let i = 0; i + 2 < buf.length; i++) if (buf[i] === 0x1b && buf[i + 1] === 0x64 && buf[i + 2] === 0x03) cuts++;
    expect(cuts).toBe(3);
  });
});

describe('厨房伝票の文字の大きさ（2026-09-21 店舗要望「Word の16番くらい」）', () => {
  const opts = { title: 'ドリンク', titleEn: 'DRINK', printedAt: '18:33', paperWidth: 80 as const };

  it('既定は「大きめ」。設定で「標準」（これまで）にできる', () => {
    expect(DEFAULT_KITCHEN_TICKET_TEXT_SIZE).toBe('large');
    expect(kitchenTicketTextSizeFrom(null)).toBe('large');
    expect(kitchenTicketTextSizeFrom({ kitchenTicket: { textSize: 'normal' } })).toBe('normal');
    expect(kitchenTicketTextSizeFrom({ kitchenTicket: { textSize: 'huge' } })).toBe('large');
    expect(kitchenTicketSettingsFrom({ kitchenTicket: { split: 'order' } })).toEqual({
      split: 'order',
      textSize: 'large',
      language: 'both',
    });
  });

  it('大きめ: 商品名（英語・日本語）と卓名は縦横2倍、伝票番号・選択肢・メモは縦2倍', () => {
    const [t] = groupKitchenTickets([
      row({
        table_name: 'T-4',
        item_name: '生ビール',
        item_name_en: 'Nama beer',
        delta: 1,
        modifiers: [{ name: '氷なし' }],
        memo: '急ぎ',
      }),
      row({ table_name: 'T-4', item_name: '水', item_name_en: 'Water', delta: 2 }),
    ]);
    const lines = layoutKitchenTicket(splitTicketByItem(t)[0], { ...opts, textSize: 'large' });
    const size = (prefix: string) => lines.find((l) => l.text.trimStart().startsWith(prefix))?.size;
    expect(size('T-4')).toBe('large');
    expect(size('No.5784  (1/2)')).toBe('tall');
    expect(size('Nama beer  x1')).toBe('large');
    expect(size('生ビール')).toBe('large');
    expect(size('・氷なし')).toBe('tall');
    expect(size('※急ぎ')).toBe('tall');
    // 見出しと罫線は今まで通り
    expect(size('DRINK')).toBe('normal');
    expect(lines.filter((l) => l.rule).every((l) => l.size === 'normal')).toBe(true);
  });

  it('縦横2倍の行は半分の桁数（80mm=24桁）で折り返す', () => {
    const [t] = groupKitchenTickets([
      row({ item_name: '長い名前', item_name_en: 'Prime Black Angus Rib Roast with Rosemary Potato' }),
    ]);
    const lines = layoutKitchenTicket(t, { ...opts, textSize: 'large' });
    const large = lines.filter((l) => l.size === 'large' && /[A-Za-z]/.test(l.text) && !l.text.startsWith('T'));
    expect(large.length).toBeGreaterThan(1);
    expect(large.every((l) => l.text.length <= 24)).toBe(true);
  });

  it('標準（これまで）は大きさを変えない', () => {
    const [t] = groupKitchenTickets([row({ item_name: '生ビール', item_name_en: 'Nama beer' }), row({ item_name: '水', item_name_en: 'Water' })]);
    const lines = layoutKitchenTicket(splitTicketByItem(t)[0], { ...opts, textSize: 'normal' });
    expect(lines.find((l) => l.text.startsWith('Nama beer  x1'))?.size).toBe('tall');
    expect(lines.find((l) => l.text.trim() === '生ビール')?.size).toBe('normal');
    expect(lines.find((l) => l.text === 'T10')?.size).toBe('tall');
  });

  it('中くらい（Word の12くらい）: 設定で選べる。大きい順に 大きめ・中くらい・標準', () => {
    expect(kitchenTicketTextSizeFrom({ kitchenTicket: { textSize: 'medium' } })).toBe('medium');
    expect(isKitchenTicketTextSize('medium')).toBe(true);
    expect(isKitchenTicketTextSize('small')).toBe(false);
    expect(KITCHEN_TICKET_TEXT_SIZES).toEqual(['large', 'medium', 'normal']);
    expect(KITCHEN_TICKET_TEXT_SIZE_LABELS.medium).toContain('12');
    // 既定は変えない（ほかの店は大きめのまま）
    expect(kitchenTicketTextSizeFrom({ kitchenTicket: {} })).toBe('large');
  });

  it('中くらい: 商品名（英語・日本語）・選択肢・メモ・伝票番号は縦2倍、卓名だけ縦横2倍', () => {
    const [t] = groupKitchenTickets([
      row({
        table_name: 'T-4',
        item_name: '生ビール',
        item_name_en: 'Nama beer',
        delta: 1,
        modifiers: [{ name: '氷なし' }],
        memo: '急ぎ',
      }),
      row({ table_name: 'T-4', item_name: '水', item_name_en: 'Water', delta: 2 }),
    ]);
    const lines = layoutKitchenTicket(splitTicketByItem(t)[0], { ...opts, textSize: 'medium' });
    const size = (prefix: string) => lines.find((l) => l.text.trimStart().startsWith(prefix))?.size;
    expect(size('T-4')).toBe('large');
    expect(size('No.5784  (1/2)')).toBe('tall');
    expect(size('Nama beer  x1')).toBe('tall');
    expect(size('生ビール')).toBe('tall');
    expect(size('・氷なし')).toBe('tall');
    expect(size('※急ぎ')).toBe('tall');
    expect(size('DRINK')).toBe('normal');
    // 縦横2倍は卓名だけ
    expect(lines.filter((l) => l.size === 'large').map((l) => l.text)).toEqual(['T-4']);
  });

  it('中くらい: 取消も縦2倍で、商品名は48桁のまま折り返さない（大きめだと2行になる長さ）', () => {
    const [c] = groupKitchenTickets([
      row({ table_name: 'T-4', item_name: 'F. カシスウーロン', item_name_en: 'F. Cassis oolong', delta: -1 }),
    ]);
    const mid = layoutKitchenTicket(c, { ...opts, textSize: 'medium', language: 'en' });
    expect(mid.find((l) => l.text.includes('*** CANCEL ***'))?.size).toBe('tall');
    expect(mid.find((l) => l.text === '[CANCEL]')?.size).toBe('tall');
    const item = mid.filter((l) => l.text.includes('Cassis'));
    expect(item).toHaveLength(1);
    expect(item[0].size).toBe('tall');
    // 同じ商品を大きめで組むと半分の桁数で折り返す
    const [long] = groupKitchenTickets([
      row({ item_name: '長い名前', item_name_en: 'Prime Black Angus Rib Roast with Potato' }),
    ]);
    const midLong = layoutKitchenTicket(long, { ...opts, textSize: 'medium', language: 'en' }).filter((l) =>
      /Angus|Potato/.test(l.text)
    );
    const bigLong = layoutKitchenTicket(long, { ...opts, textSize: 'large', language: 'en' }).filter((l) =>
      /Angus|Potato|Roast|with/.test(l.text)
    );
    expect(midLong).toHaveLength(1);
    expect(bigLong.length).toBeGreaterThan(1);
  });

  it('中くらいは Markup に縦2倍、卓名だけ縦横2倍の指定が入る', () => {
    const [t] = groupKitchenTickets([row({ item_name: '生ビール', item_name_en: 'Nama beer' })]);
    const markup = kitchenTicketMarkup(layoutKitchenTicket(t, { ...opts, textSize: 'medium' }));
    expect(markup).toContain('[magnify: width 1; height 2]');
    expect(markup.split('[magnify: width 2; height 2]').length - 1).toBe(1);
  });

  it('大きめでも Markup・StarPRNT に縦横2倍の指定が入る', () => {
    const [t] = groupKitchenTickets([row({ item_name: '生ビール', item_name_en: 'Nama beer' })]);
    const lines = layoutKitchenTicket(t, { ...opts, textSize: 'large' });
    expect(kitchenTicketMarkup(lines)).toContain('[magnify: width 2; height 2]');
    const buf = kitchenTicketStarPrnt(lines);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe('ドリンク機に出ないカテゴリの検出', () => {
  it('ドリンク商品があるのにステーションがドリンクでないカテゴリを返す', () => {
    const cats = [
      { id: 'c1', name: '(F) BEER', station: 'kitchen' },
      { id: 'c2', name: 'ワイン', station: 'drink' },
      { id: 'c3', name: 'サラダ', station: 'kitchen' },
      { id: 'c4', name: 'ソフトドリンク', station: null },
    ];
    expect(misroutedDrinkCategories(cats, ['c1', 'c2', 'c4', null])).toEqual(['(F) BEER', 'ソフトドリンク']);
    expect(misroutedDrinkCategories(cats, [])).toEqual([]);
  });
});

describe('厨房伝票の商品名の言語（2026-09-21 Ronnie「キッチン英語だけで大丈夫」）', () => {
  const opts = { title: 'ドリンク 伝票', titleEn: 'DRINK', printedAt: '18:33', paperWidth: 80 as const, textSize: 'large' as const };

  it('既定は「英語と日本語」（これまで）。設定で「英語だけ」', () => {
    expect(kitchenTicketLanguageFrom(null)).toBe('both');
    expect(kitchenTicketLanguageFrom({ kitchenTicket: { language: 'en' } })).toBe('en');
    expect(kitchenTicketLanguageFrom({ kitchenTicket: { language: 'fr' } })).toBe('both');
    expect(kitchenTicketSettingsFrom({ kitchenTicket: { language: 'en' } }).language).toBe('en');
  });

  it('英語だけ: 日本語の商品名・見出しを出さない', () => {
    const [t] = groupKitchenTickets([
      row({ table_name: 'T-4', item_name: '水', item_name_en: 'Water', delta: 2 }),
      row({ table_name: 'T-4', item_name: 'F. 生ビール', item_name_en: 'F. Nama beer', delta: 1 }),
    ]);
    const texts = layoutKitchenTicket(splitTicketByItem(t)[0], { ...opts, language: 'en' }).map((l) => l.text);
    expect(texts).toContain('DRINK');
    expect(texts).not.toContain('ドリンク 伝票');
    expect(texts).toContain('Water  x2');
    expect(texts.some((x) => x.includes('水'))).toBe(false);
    // 英語と日本語（これまで）は日本語も出る
    const both = layoutKitchenTicket(splitTicketByItem(t)[0], { ...opts, language: 'both' }).map((l) => l.text);
    expect(both).toContain('ドリンク 伝票');
    expect(both).toContain(' 水');
  });

  it('英語だけ: 取消・テイクアウトも英語だけ。取消の印は別の行で商品名を折り返さない', () => {
    const [t] = groupKitchenTickets([
      row({ table_name: null, item_name: 'F. カシスウーロン', item_name_en: 'F. Cassis oolong', delta: -1 }),
    ]);
    const texts = layoutKitchenTicket(t, { ...opts, language: 'en' }).map((l) => l.text);
    expect(texts).toContain('TAKEOUT');
    expect(texts).toContain('*** CANCEL ***');
    const at = texts.indexOf('[CANCEL]');
    expect(texts[at + 1]).toBe('F. Cassis oolong  x1');
    expect(texts.some((x) => /取消|テイクアウト|カシス/.test(x))).toBe(false);
  });

  it('英語だけ: 英語名の無い商品は日本語で出す（情報を落とさない）', () => {
    const [t] = groupKitchenTickets([row({ item_name: '本日のおすすめ', item_name_en: null, item_name_kana: null })]);
    const texts = layoutKitchenTicket(t, { ...opts, language: 'en' }).map((l) => l.text);
    expect(texts.some((x) => x.startsWith('本日のおすすめ'))).toBe(true);
  });
});
