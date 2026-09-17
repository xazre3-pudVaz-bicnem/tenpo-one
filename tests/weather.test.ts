import { describe, expect, it } from 'vitest';
import {
  describeWeatherCode,
  formatPlaceEn,
  geocodeCandidates,
  parseJapaneseAddress,
  pickGeoResult,
  stripAdminSuffix,
} from '@/lib/weather';

describe('parseJapaneseAddress', () => {
  it('東京23区: 区と町名を取り出す（丁目・番地・建物名は除く）', () => {
    expect(parseJapaneseAddress('東京都新宿区高田馬場1-2-3 ○○ビル5F')).toEqual({
      prefecture: '東京都',
      city: null,
      ward: '新宿区',
      town: '高田馬場',
    });
  });
  it('漢数字の丁目を外す', () => {
    expect(parseJapaneseAddress('東京都新宿区西新宿二丁目8番1号').town).toBe('西新宿');
  });
  it('郵便番号・全角数字が付いていても解析できる', () => {
    const p = parseJapaneseAddress('〒160-0023 東京都新宿区西新宿３－１');
    expect(p.prefecture).toBe('東京都');
    expect(p.ward).toBe('新宿区');
    expect(p.town).toBe('西新宿');
  });
  it('政令指定都市: 市・区・町名', () => {
    expect(parseJapaneseAddress('神奈川県横浜市中区本町1-1')).toEqual({
      prefecture: '神奈川県',
      city: '横浜市',
      ward: '中区',
      town: '本町',
    });
  });
  it('東京都の市（八王子市）は区として扱わない', () => {
    const p = parseJapaneseAddress('東京都八王子市旭町1-1');
    expect(p.city).toBe('八王子市');
    expect(p.ward).toBeNull();
    expect(p.town).toBe('旭町');
  });
  it('「市」を含む市名（市川市・四日市市）', () => {
    expect(parseJapaneseAddress('千葉県市川市八幡2-1').city).toBe('市川市');
    expect(parseJapaneseAddress('三重県四日市市諏訪町1-5').city).toBe('四日市市');
  });
  it('郡部の町（北佐久郡軽井沢町）', () => {
    const p = parseJapaneseAddress('長野県北佐久郡軽井沢町大字軽井沢1323');
    expect(p.city).toBe('軽井沢町');
    expect(p.town).toBe('軽井沢');
  });
  it('空・null は全て null', () => {
    expect(parseJapaneseAddress(null)).toEqual({ prefecture: null, city: null, ward: null, town: null });
    expect(parseJapaneseAddress('')).toEqual({ prefecture: null, city: null, ward: null, town: null });
  });
});

describe('geocodeCandidates / pickGeoResult', () => {
  it('細かい地名から順に候補を作る', () => {
    const c = geocodeCandidates(parseJapaneseAddress('東京都新宿区高田馬場1-2-3'));
    expect(c.map((x) => x.query)).toEqual(['高田馬場', '新宿', '新宿区', '東京都']);
    expect(c[0].parent).toBe('新宿区');
  });
  it('住所なしなら候補なし（呼び出し側で Tokyo にフォールバック）', () => {
    expect(geocodeCandidates(parseJapaneseAddress(undefined))).toEqual([]);
  });
  it('都道府県・上位の区が一致する結果だけを採用する', () => {
    const cand = { query: '本町', prefecture: '神奈川県', parent: '中区' };
    const results = [
      { id: 1, name: '本町', admin1: '北海道', admin2: '亀田郡' },
      { id: 2, name: '本町', admin1: '神奈川県', admin2: '横浜市', admin3: '中区' },
    ];
    expect(pickGeoResult(results, cand)?.id).toBe(2);
    expect(pickGeoResult(results.slice(0, 1), cand)).toBeNull();
  });
  it('接尾辞の有無は区別しない', () => {
    expect(stripAdminSuffix('新宿区')).toBe('新宿');
    expect(stripAdminSuffix('北海道')).toBe('北海道');
    const cand = { query: '新宿', prefecture: '東京都', parent: null };
    expect(pickGeoResult([{ id: 9, name: '新宿', admin1: '東京' }], cand)?.id).toBe(9);
  });
});

describe('formatPlaceEn', () => {
  it('地名, 都道府県 を大文字で', () => {
    expect(formatPlaceEn('Takadanobaba', 'Tokyo')).toBe('TAKADANOBABA, TOKYO');
  });
  it('同名は1回だけ', () => {
    expect(formatPlaceEn('Tokyo', 'Tokyo')).toBe('TOKYO');
  });
  it('空なら TOKYO', () => {
    expect(formatPlaceEn(null, undefined)).toBe('TOKYO');
  });
});

describe('describeWeatherCode', () => {
  it('代表的なコードを日本語に変換する', () => {
    expect(describeWeatherCode(0)).toEqual({ label: '快晴', icon: 'sun' });
    expect(describeWeatherCode(2)).toEqual({ label: '晴れ時々くもり', icon: 'partly' });
    expect(describeWeatherCode(3)?.icon).toBe('cloud');
    expect(describeWeatherCode(45)?.label).toBe('霧');
    expect(describeWeatherCode(63)).toEqual({ label: '雨', icon: 'rain' });
    expect(describeWeatherCode(73)?.icon).toBe('snow');
    expect(describeWeatherCode(95)?.icon).toBe('thunder');
  });
  it('不明なコード・null は null（天気を出さない）', () => {
    expect(describeWeatherCode(42)).toBeNull();
    expect(describeWeatherCode(null)).toBeNull();
    expect(describeWeatherCode(Number.NaN)).toBeNull();
  });
});
