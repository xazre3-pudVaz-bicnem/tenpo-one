/** CSVインポート用の軽量パーサ（外部ライブラリなし）。ダブルクォート・カンマ・改行を含むセルに対応する。 */

/** データ行の上限（ヘッダー行は含まない） */
export const MAX_IMPORT_ROWS = 1000;

/**
 * RFC4180相当の簡易CSVパーサ。
 * - ダブルクォートで囲まれたセル内のカンマ・改行・エスケープされたダブルクォート（""）に対応
 * - CRLF / LF / CR いずれの改行にも対応
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF / CR いずれも1行の区切りとして扱う
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // 末尾に未確定のセル・行が残っていれば追加（末尾改行なしのファイル対応）
  if (cell !== '' || row.length > 0) {
    pushRow();
  }

  // 完全な空行（要素1つでその値も空文字）は除去
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export class CsvEncodingError extends Error {}

/**
 * File を読み込みCSVテキストへデコードする。
 * UTF-8として不正なバイト列（Shift_JIS等の可能性が高い）の場合は CsvEncodingError を投げる。
 * 先頭のBOM（EF BB BF）は取り除く。
 */
export async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new CsvEncodingError('文字コードがUTF-8ではありません。Excel等で保存する際は「CSV UTF-8」形式で保存し直してください。');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}
