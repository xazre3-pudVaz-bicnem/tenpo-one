import { describe, it, expect } from 'vitest';
import { splitStoreName, fitPt } from '@/lib/store-name';

/** 2026-10-19 Ronnie「店名が途中で折り返すのはダメ。1行目に店名、2行目に支店」 */
describe('店舗名を店名と支店の2行に', () => {
  it('最後のスペースのあとが日本語なら支店', () => {
    expect(splitStoreName('ORIENTAL ELEPHANT 高田馬場店')).toEqual({ brand: 'ORIENTAL ELEPHANT', branch: '高田馬場店' });
    expect(splitStoreName('MEAT CROWN 新横浜')).toEqual({ brand: 'MEAT CROWN', branch: '新横浜' });
    expect(splitStoreName('SEABIRD COLONY　銀座本店')).toEqual({ brand: 'SEABIRD COLONY', branch: '銀座本店' });
    expect(splitStoreName('肉ギャング 渋谷本店')).toEqual({ brand: '肉ギャング', branch: '渋谷本店' });
    expect(splitStoreName('SPICE＆MEAT CROWN 新横浜')).toEqual({ brand: 'SPICE＆MEAT CROWN', branch: '新横浜' });
  });
  it('スペースなしでも英字のあとに日本語が続けば分ける', () => {
    expect(splitStoreName('MEAT CROWN新横浜')).toEqual({ brand: 'MEAT CROWN', branch: '新横浜' });
    expect(splitStoreName('FULLMOoN御茶ノ水')).toEqual({ brand: 'FULLMOoN', branch: '御茶ノ水' });
  });
  it('支店が無ければ1行のまま', () => {
    expect(splitStoreName('ORIENTAL ELEPHANT')).toEqual({ brand: 'ORIENTAL ELEPHANT', branch: null });
    expect(splitStoreName('しゅんか')).toEqual({ brand: 'しゅんか', branch: null });
  });
  it('長い店名は字を小さくして1行に（最小まで）', () => {
    expect(fitPt('MEAT CROWN', 44, 11.5, 7)).toBe(11.5);
    const long = fitPt('ORIENTAL ELEPHANT', 44, 11.5, 7);
    expect(long).toBeLessThan(11.5);
    expect(long).toBeGreaterThanOrEqual(7);
    expect(fitPt('とても長い店舗の名前がここに入りますとても長い', 44, 11.5, 7)).toBe(7);
  });
});
