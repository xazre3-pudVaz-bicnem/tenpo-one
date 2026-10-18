import { describe, it, expect } from 'vitest';
import { normalizeOcrLine, parseMenuLines, pdfTextLines } from '@/lib/menu-ocr-parse';

/** 2026-10-18 Ronnie「メニューの PDF・写真をアップロードして自動でメニューに。お金がかからないもので」 */
describe('メニューの読み取り：行 → 商品', () => {
  it('OCR の空白（漢字かなの間）・全角・税込を整える', () => {
    expect(normalizeOcrLine('生 ビ ー ル　　５８０円')).toBe('生ビール 580円');
    expect(normalizeOcrLine('ハイボール 500円(税込550円)')).toBe('ハイボール ¥550');
    expect(normalizeOcrLine('TEL 045-548-5040 営業 17:00')).not.toMatch(/\d{3,}/);
    // 写真の読み取りでカンマが空白・点になる
    expect(normalizeOcrLine('牛タン塩焼き 1 280円')).toBe('牛タン塩焼き 1,280円');
    expect(normalizeOcrLine('牛タン塩焼き 1.280')).toBe('牛タン塩焼き 1,280');
    expect(normalizeOcrLine('枝豆 480円')).toBe('枝豆 480円');
  });

  it('見出し → カテゴリ、名前と価格、英語名、2列のメニュー', () => {
    const rows = parseMenuLines([
      'ドリンク',
      '生ビール Draft Beer ¥580',
      'ハイボール 500円',
      'おつまみ',
      '枝豆 380 冷やしトマト 420',
      '牛タン塩焼き',
      '1,280円',
      '国産の牛タンを丁寧に焼き上げました。おすすめです。',
    ]);
    expect(rows).toEqual([
      { categoryName: 'ドリンク', name: '生ビール', nameEn: 'Draft Beer', price: 580, itemType: 'drink' },
      { categoryName: 'ドリンク', name: 'ハイボール', nameEn: '', price: 500, itemType: 'drink' },
      { categoryName: 'おつまみ', name: '枝豆', nameEn: '', price: 380, itemType: 'food' },
      { categoryName: 'おつまみ', name: '冷やしトマト', nameEn: '', price: 420, itemType: 'food' },
      { categoryName: 'おつまみ', name: '牛タン塩焼き', nameEn: '', price: 1280, itemType: 'food' },
    ]);
  });

  it('同じ商品は1つだけ・見出しが無ければ「メニュー」', () => {
    const rows = parseMenuLines(['唐揚げ 600', '唐揚げ 600']);
    expect(rows).toEqual([{ categoryName: 'メニュー', name: '唐揚げ', nameEn: '', price: 600, itemType: 'food' }]);
  });
});

describe('PDF の文字 → 行', () => {
  const it_ = (str: string, x: number, y: number, h = 10, width?: number) => ({ str, transform: [h, 0, 0, h, x, y], height: h, width: width ?? str.length * h });
  it('同じ高さは1行・上から下・離れていれば空白', () => {
    const lines = pdfTextLines([
      it_('580円', 200, 700),
      it_('生ビール', 50, 702),
      it_('ドリンク', 50, 740, 14),
      it_('ハイボール', 50, 680),
      it_('500円', 200, 680),
    ]);
    expect(lines).toEqual(['ドリンク', '生ビール 580円', 'ハイボール 500円']);
    expect(parseMenuLines(lines).map((r) => [r.categoryName, r.name, r.price])).toEqual([
      ['ドリンク', '生ビール', 580],
      ['ドリンク', 'ハイボール', 500],
    ]);
  });
  it('くっついている文字は空白を入れない', () => {
    expect(pdfTextLines([it_('生ビ', 50, 700, 10, 20), it_('ール', 70, 700, 10, 20)])).toEqual(['生ビール']);
  });
});
