/** CSV生成（Excel互換のためBOM付きUTF-8） */

/**
 * CSVフォーミュラ・インジェクション対策。
 * Excel/Sheets等はセル先頭が = + - @ tab CR の場合、内容を数式として実行しうる。
 * 該当する場合は先頭にシングルクオートを付けて数式化を無効化する。
 * 数値(number)はそのまま（先頭記号でも数値リテラルとして安全）。
 */
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined) => {
    if (v == null) return '';
    // 文字列のみフォーミュラ無害化（数値は数式インジェクションの対象にならない）
    const s = typeof v === 'number' ? String(v) : neutralizeFormula(String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return '﻿' + lines.join('\r\n');
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
