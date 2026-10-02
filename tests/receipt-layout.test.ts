import { describe, it, expect } from 'vitest';
import { dispWidth, twoCol, wrapText, STAR_WIDTH_OPTIONS,
  billSlipLines,
  mergeSameLines,
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

describe('同じものを1行にまとめる（2026-10-02 御茶ノ水「レシートで同じものがまとまるように」）', () => {
  const L = (
    name: string,
    quantity: number,
    unitPrice: number,
    modifiers: { name: string; price: number }[] = [],
    cancelled = false
  ) => ({
    name,
    quantity,
    unitPrice,
    lineTotal: quantity * (unitPrice + modifiers.reduce((a, m) => a + m.price, 0)),
    modifiers,
    cancelled,
  });

  it('同じ名前・単価は数量と金額を足して1行（最初の位置）', () => {
    const lines = [L('ウーロン茶', 1, 480), L('プレーンバゲット', 1, 300), L('ウーロン茶', 3, 480)];
    const merged = mergeSameLines(lines);
    expect(merged.map((l) => [l.name, l.quantity, l.lineTotal])).toEqual([
      ['ウーロン茶', 4, 1920],
      ['プレーンバゲット', 1, 300],
    ]);
  });

  it('単価が違えば別の行', () => {
    const merged = mergeSameLines([L('生ハム', 1, 1200), L('生ハム', 1, 1500)]);
    expect(merged).toHaveLength(2);
  });

  it('選択肢が同じならまとめる（並び順は問わない）・違えば別の行', () => {
    const a = { name: '大盛り', price: 100 };
    const b = { name: 'チーズ', price: 200 };
    expect(mergeSameLines([L('ポテト', 1, 600, [a, b]), L('ポテト', 2, 600, [b, a])])).toHaveLength(1);
    expect(mergeSameLines([L('ポテト', 1, 600, [a, b]), L('ポテト', 2, 600, [b, a])])[0].lineTotal).toBe(2700);
    expect(mergeSameLines([L('ポテト', 1, 600, [a]), L('ポテト', 1, 600)])).toHaveLength(2);
  });

  it('取消済みの行はまとめない', () => {
    const merged = mergeSameLines([L('ウーロン茶', 1, 480), L('ウーロン茶', 1, 480, [], true), L('ウーロン茶', 2, 480)]);
    expect(merged.map((l) => [l.quantity, l.cancelled])).toEqual([
      [3, false],
      [1, true],
    ]);
  });

  it('元の明細は書き換えない', () => {
    const lines = [L('ウーロン茶', 1, 480), L('ウーロン茶', 3, 480)];
    mergeSameLines(lines);
    expect(lines[0].quantity).toBe(1);
  });

  it('お会計伝票（billSlipLines）でもまとまる・0円の行は落ちたまま', () => {
    const lines = [L('ウーロン茶', 1, 480), L('生ビール', 1, 0), L('ウーロン茶', 3, 480)];
    expect(billSlipLines(lines).map((l) => [l.name, l.quantity, l.lineTotal])).toEqual([['ウーロン茶', 4, 1920]]);
  });

  it('合計金額は変わらない', () => {
    const lines = [L('A', 1, 480), L('B', 2, 300), L('A', 3, 480), L('B', 1, 300)];
    const sum = (ls: { lineTotal: number }[]) => ls.reduce((a, l) => a + l.lineTotal, 0);
    expect(sum(mergeSameLines(lines))).toBe(sum(lines));
  });
});
