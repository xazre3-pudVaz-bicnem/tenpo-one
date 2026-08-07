import type { ImportFieldDef, ImportType, ParsedRow, RowIssue } from './types';
import { validateCustomerRow, validateInventoryItemRow, validateMenuItemRow, validateVendorRow } from './validators';

/** マッピング結果から、行ごとの {フィールドキー: セル文字列} を組み立てる */
export function buildParsedRows(
  dataRows: string[][],
  mapping: Record<string, number | null>,
  fields: ImportFieldDef[]
): ParsedRow[] {
  return dataRows.map((cells, idx) => {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const colIndex = mapping[field.key];
      values[field.key] = colIndex != null ? (cells[colIndex] ?? '').trim() : '';
    }
    // ヘッダーが1行目なので、データ行は2行目から始まる
    return { rowNumber: idx + 2, values };
  });
}

function validateOne(type: ImportType, values: Record<string, string>): { ok: boolean; errors?: string[]; dupKey: string | null } {
  switch (type) {
    case 'menu_items': {
      const r = validateMenuItemRow(values);
      return r.ok ? { ok: true, dupKey: r.dupKey } : { ok: false, errors: r.errors, dupKey: null };
    }
    case 'customers': {
      const r = validateCustomerRow(values);
      return r.ok ? { ok: true, dupKey: r.dupKey } : { ok: false, errors: r.errors, dupKey: null };
    }
    case 'vendors': {
      const r = validateVendorRow(values);
      return r.ok ? { ok: true, dupKey: r.dupKey } : { ok: false, errors: r.errors, dupKey: null };
    }
    case 'inventory_items': {
      const r = validateInventoryItemRow(values);
      return r.ok ? { ok: true, dupKey: r.dupKey } : { ok: false, errors: r.errors, dupKey: null };
    }
  }
}

export interface LocalValidation {
  issues: RowIssue[];
  /** サーバーへ既存重複チェックを依頼する対象キー（一意化済み） */
  dupKeysToCheck: string[];
}

/**
 * クライアント側の検証・プレビュー用。
 * 必須項目・数値/電話/日付形式のチェックと、ファイル内での重複（同じ行が複数ある場合）を検出する。
 * DBに既に存在するかどうかはこの時点では分からないため別途 checkExistingDuplicates で確認する。
 */
export function validateRowsLocally(type: ImportType, rows: ParsedRow[]): LocalValidation {
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  const dupKeysToCheck: string[] = [];
  const dupKeysToCheckSet = new Set<string>();

  for (const row of rows) {
    const r = validateOne(type, row.values);
    if (!r.ok) {
      issues.push({ rowNumber: row.rowNumber, status: 'error', reason: (r.errors ?? []).join(' / ') });
      continue;
    }
    if (r.dupKey !== null) {
      if (seen.has(r.dupKey)) {
        issues.push({
          rowNumber: row.rowNumber,
          status: 'duplicate',
          reason: '重複（ファイル内に同じ内容の行があります）スキップされます',
          dupKey: r.dupKey,
        });
        continue;
      }
      seen.add(r.dupKey);
      if (!dupKeysToCheckSet.has(r.dupKey)) {
        dupKeysToCheckSet.add(r.dupKey);
        dupKeysToCheck.push(r.dupKey);
      }
    }
    issues.push({ rowNumber: row.rowNumber, status: 'ok', dupKey: r.dupKey });
  }

  return { issues, dupKeysToCheck };
}

/** サーバーの既存重複チェック結果（登録済みのdupKey集合）を反映し、最終ステータスを確定する */
export function applyExistingDuplicates(issues: RowIssue[], existingKeys: Set<string>): RowIssue[] {
  return issues.map((issue) => {
    if (issue.status === 'ok' && issue.dupKey && existingKeys.has(issue.dupKey)) {
      return { ...issue, status: 'duplicate', reason: '重複（登録済みのデータがあります）スキップされます' };
    }
    return issue;
  });
}
