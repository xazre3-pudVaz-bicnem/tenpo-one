import { describe, it, expect } from 'vitest';
import { dispWidth, twoCol, wrapText, STAR_WIDTH_OPTIONS,
  billSlipLines,
} from '@/lib/receipt-layout';
import { layoutKitchenTicket, groupKitchenTickets, type ClaimedKitchenItem } from '@/lib/kitchen-ticket';

/**
 * Star mC-Print3 は全角文字が半角2桁よりわずかに広く印字される（御茶ノ水の実機レシート）。
 * 「小計 ……… ¥10,545」のような 48 桁ぴったりの行は末尾の 1 文字が次行に落ちていたため、
 * Star 向けの桁揃え・折り返しは cjkExtra ぶんを見込む。
 */
describe('cjkExtra（Star 機の全角幅）', () => {
  it('既定（cjkExtra なし）は従来どおり全角=2桁', () => {
    expect(dispWidth('小計')).toBe(4);
    expect(dispWidth(twoCol('小計', '¥10,545', 48))).toBe(48);
  });

  it('Star 向けは全角に上乗せして数え、詰め物を減らして物理幅 48 に収める', () => {
    expect(dispWidth('小計', STAR_WIDTH_OPTIONS)).toBeCloseTo(4.34, 5);
    const line = twoCol('小計', '¥10,545', 48, STAR_WIDTH_OPTIONS);
    expect(dispWidth(line)).toBe(47); // 見かけは 47 桁（右端に 1 桁の余裕）
    expect(dispWidth(line, STAR_WIDTH_OPTIONS)).toBeLessThanOrEqual(48); // 実機では 48 桁以内
    expect(line.endsWith('¥10,545')).toBe(true);
  });

  it('全角を含まない行は従来どおり右端（48桁）まで使う', () => {
    expect(dispWidth(twoCol('  2 x ¥5,800', '¥11,600', 48, STAR_WIDTH_OPTIONS))).toBe(48);
  });

  it('税率行のように左右とも全角を含む行も収まる', () => {
    const line = twoCol('  (税10%対象 ¥11,600)', '税¥1,055', 48, STAR_WIDTH_OPTIONS);
    expect(line.includes('\n')).toBe(false);
    expect(dispWidth(line, STAR_WIDTH_OPTIONS)).toBeLessThanOrEqual(48);
  });
});

describe('wrapText', () => {
  const address = '東京都千代田区神田駿河台2-6-11 第87東京ビル 4F';

  it('既定の数え方では 46 桁なので折り返さない', () => {
    expect(wrapText(address, 48)).toEqual([address]);
  });

  it('Star 向けは実機で「F」だけ落ちるのを避け、直前のスペースで折る', () => {
    const lines = wrapText(address, 48, STAR_WIDTH_OPTIONS);
    expect(lines).toEqual(['東京都千代田区神田駿河台2-6-11', '第87東京ビル 4F']);
    for (const l of lines) expect(dispWidth(l, STAR_WIDTH_OPTIONS)).toBeLessThanOrEqual(48);
  });

  it('スペースが無い長い文章は桁数で切る', () => {
    const lines = wrapText('あ'.repeat(30), 48, STAR_WIDTH_OPTIONS);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(dispWidth(l, STAR_WIDTH_OPTIONS)).toBeLessThanOrEqual(48);
    expect(lines.join('')).toBe('あ'.repeat(30));
  });

  it('改行はそのまま段落として扱う', () => {
    expect(wrapText('ご来店ありがとうございました。\nまたのお越しを', 48)).toEqual([
      'ご来店ありがとうございました。',
      'またのお越しを',
    ]);
  });
});

describe('厨房伝票（Star 向け）', () => {
  const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
    order_id: 'o1',
    order_no: 5784,
    table_name: 'T10',
    guest_count: 2,
    clerk_name: null,
    station: 'kitchen',
    item_name: '和牛ユッケ＆リブロースの食べ放題コース（大人）',
    item_name_en: null,
    delta: 1,
    memo: null,
    modifiers: null,
    ...over,
  });

  it('全角の長い商品名も実機の 48 桁に収まる', () => {
    const [t] = groupKitchenTickets([row({})]);
    const lines = layoutKitchenTicket(t, { title: 'キッチン', printedAt: '18:21', paperWidth: 80, ...STAR_WIDTH_OPTIONS });
    for (const l of lines) expect(dispWidth(l.text, STAR_WIDTH_OPTIONS)).toBeLessThanOrEqual(48);
    expect(lines.some((l) => l.text.includes('和牛ユッケ'))).toBe(true);
  });
});

describe('お会計伝票の明細（0円の行を出さない）', () => {
  const L = (name: string, lineTotal: number, modifiers: { price: number }[] = []) => ({
    name,
    quantity: 1,
    unitPrice: lineTotal,
    lineTotal,
    modifiers,
  });

  it('0円の行（飲み放題の中身など）を落とす', () => {
    const lines = [L('生ビール', 0), L('自家製サングリア', 700), L('ウーロン茶', 0), L('マルゲリータ', 980)];
    expect(billSlipLines(lines).map((l) => l.name)).toEqual(['自家製サングリア', 'マルゲリータ']);
  });

  it('本体0円でも選択肢に値段があれば残す', () => {
    const lines = [L('ハイボール', 0, [{ price: 100 }]), L('ウーロン茶', 0, [{ price: 0 }])];
    expect(billSlipLines(lines).map((l) => l.name)).toEqual(['ハイボール']);
  });

  it('全部0円のときは伝票が空にならないよう元の明細を返す', () => {
    const lines = [L('生ビール', 0), L('ウーロン茶', 0)];
    expect(billSlipLines(lines)).toEqual(lines);
  });

  it('明細が無いときは空のまま', () => {
    expect(billSlipLines([])).toEqual([]);
  });
});
