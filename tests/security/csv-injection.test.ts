import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

// BOMを除いた実データ部分を取り出す
function body(csv: string): string {
  return csv.replace(/^﻿/, '');
}

describe('CSVフォーミュラ・インジェクション対策 toCsv', () => {
  it('数式開始文字（= + - @）で始まる文字列は無害化される', () => {
    const csv = body(toCsv(['col'], [['=1+1'], ['+cmd'], ['-2+3'], ['@SUM(A1)']]));
    const lines = csv.split('\r\n');
    // クオートで囲まれず先頭にシングルクオートが付く（=はカンマ等を含まないため引用符不要）
    expect(lines[1]).toBe("'=1+1");
    expect(lines[2]).toBe("'+cmd");
    expect(lines[3]).toBe("'-2+3");
    expect(lines[4]).toBe("'@SUM(A1)");
  });

  it('タブ・CR始まりも先頭にシングルクオートが付く', () => {
    // タブ始まり: 数式化は無効化されるが、タブはCSV特殊文字でないため引用符なし
    const tabCsv = body(toCsv(['col'], [['\tevil']]));
    expect(tabCsv.split('\r\n')[1]).toBe("'\tevil");
    // CR始まり: CRはCSV特殊文字なので引用符で囲まれ、かつ先頭にシングルクオート
    const crCsv = body(toCsv(['col'], [['\rvil']]));
    expect(crCsv.includes('"\'\r')).toBe(true);
  });

  it('数値は無害化対象外（そのまま出力）', () => {
    const csv = body(toCsv(['n'], [[-500], [1000]]));
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('-500');
    expect(lines[2]).toBe('1000');
  });

  it('通常テキストは変更されない', () => {
    const csv = body(toCsv(['name'], [['田中太郎'], ['Store A']]));
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('田中太郎');
    expect(lines[2]).toBe('Store A');
  });

  it('カンマ・引用符・改行を含む値は正しくエスケープされる', () => {
    const csv = body(toCsv(['v'], [['a,b'], ['he said "hi"']]));
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('"a,b"');
    expect(lines[2]).toBe('"he said ""hi"""');
  });

  it('先頭が数式文字かつカンマを含む場合は両方適用', () => {
    const csv = body(toCsv(['v'], [['=1,2']]));
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('"\'=1,2"');
  });
});
