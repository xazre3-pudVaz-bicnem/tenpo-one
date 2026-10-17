import { describe, it, expect } from 'vitest';
import { toRomaji, romanItemName, hasUnromanizable, englishName, categoryEnglishName } from '@/lib/romaji';

describe('toRomaji', () => {
  it('カタカナを変換する', () => {
    expect(toRomaji('チキンカレー')).toBe('chikinkaree');
    expect(toRomaji('ナン')).toBe('nan');
    expect(toRomaji('ラーメン')).toBe('raamen');
  });

  it('ひらがなを変換する', () => {
    expect(toRomaji('からあげ')).toBe('karaage');
  });

  it('拗音・促音を扱う', () => {
    expect(toRomaji('シャケ')).toBe('shake');
    expect(toRomaji('ラッシー')).toBe('rasshii');
    expect(toRomaji('コロッケ')).toBe('korokke');
    expect(toRomaji('マッチャ')).toBe('matcha');
  });

  it('撥音の後の母音は n\' で切る', () => {
    expect(toRomaji('シンイチ')).toBe("shin'ichi");
  });

  it('ASCIIはそのまま残す', () => {
    expect(toRomaji('Aセット 2')).toBe('Asetto 2');
  });
});

describe('hasUnromanizable', () => {
  it('漢字を検出する', () => {
    expect(hasUnromanizable('本日のラッサム')).toBe(true);
    expect(hasUnromanizable('ラッサム')).toBe(false);
  });
});

describe('romanItemName', () => {
  it('カナからローマ字を作る', () => {
    expect(romanItemName('本日のラッサム', 'ホンジツノラッサム')).toBe('Honjitsunorassamu');
  });

  it('カナ欄が英語名ならそのまま使う', () => {
    expect(romanItemName('シーフードスープ', 'Seafood Soup')).toBe('Seafood Soup');
  });

  it('カナが無く漢字を含むときは null（日本語名のみ印字）', () => {
    expect(romanItemName('本日のラッサム', null)).toBeNull();
  });

  it('カナが無くてもカタカナ名なら変換する', () => {
    expect(romanItemName('シーフードスープ', null)).toBe('Shiifuudosuupu');
  });

  it('商品名と同じ英語名なら重複印字しない（null）', () => {
    expect(romanItemName('Seafood Soup', 'Seafood Soup')).toBeNull();
  });
});

describe('englishName', () => {
  it('手入力の英語名（name_en）を最優先する', () => {
    expect(englishName('チキンカレー', 'チキンカレー', 'Chicken Curry')).toBe('Chicken Curry');
  });

  it('name_en が無ければカナからローマ字を作る', () => {
    expect(englishName('チキンカレー', 'チキンカレー', null)).toBe('Chikinkaree');
    expect(englishName('チキンカレー', 'チキンカレー', '  ')).toBe('Chikinkaree');
  });

  it('日本語名と同じ文字列が英語名欄に入っていたら英語なし扱いにする', () => {
    expect(englishName('チキンカレー', null, 'チキンカレー')).toBe('Chikinkaree');
  });

  it('カナも英語名も無く漢字だけなら null（日本語のみ表示）', () => {
    expect(englishName('特上寿司', null, null)).toBeNull();
  });

  it('前後の空白は落とす', () => {
    expect(englishName('ピカーニャ', 'ピカーニャ', '  Picanha (Beef)  ')).toBe('Picanha (Beef)');
  });
});

describe('カテゴリの英語名（2026-10-18 SHUNKA「Sawaa hai → SOUR HI。カテゴリ名は自動で大文字」）', () => {
  it('組み合わせの名前は言葉ごとに英語にする（全部わかるときだけ）', () => {
    expect(englishName('サワー・ハイ', null, null)).toBe('Sour / Hi');
    expect(englishName('ウイスキー・ハイボール', null, null)).toBe('Whisky / Highball');
    expect(englishName('焼き鳥・焼き物', null, null)).toBe('Yakitori / Grilled');
    // 「(A)」が付いていれば飲み放題の言葉は省く（飲み放題のタブの中なので）
    expect(englishName('(A) 飲み放題 サワー・ハイ', null, null)).toBe('(A) Sour / Hi');
    expect(englishName('（B） 飲み放題 ビール', null, null)).toBe('(B) Beer');
    expect(englishName('飲み放題 ビール', null, null)).toBe('Nomihodai Beer');
    // 1つでも表に無い言葉があれば今まで通り（ローマ字か日本語）
    expect(englishName('サワー・ホッピー', null, null)).toBe('Sawaa hoppii');
  });

  it('よく使うカテゴリ名を英語にする', () => {
    expect(englishName('梅酒', null, null)).toBe('Umeshu');
    expect(englishName('おつまみ', null, null)).toBe('Snacks');
    expect(englishName('肉寿司', null, null)).toBe('Meat sushi');
    expect(englishName('鍋単品', null, null)).toBe('Hot pot add-ons');
    expect(englishName('延長', null, null)).toBe('Extension');
  });

  it('categoryEnglishName は全部大文字（手で入れた英語名も）', () => {
    expect(categoryEnglishName('サワー・ハイ', null)).toBe('SOUR / HI');
    expect(categoryEnglishName('ビール', null)).toBe('BEER');
    expect(categoryEnglishName('カレーセット', 'Curry Set')).toBe('CURRY SET');
    expect(categoryEnglishName('特上寿司', null)).toBeNull();
  });
});
