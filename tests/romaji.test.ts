import { describe, it, expect } from 'vitest';
import { toRomaji, romanItemName, hasUnromanizable, englishName } from '@/lib/romaji';

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
