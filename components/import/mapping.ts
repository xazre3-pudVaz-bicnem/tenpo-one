import type { ImportFieldDef } from './types';

/**
 * CSVヘッダーと取込フィールドの自動対応付け。
 * 1. 列名の完全一致（フィールドラベル or 別名と一致）を優先
 * 2. 見つからなければ部分一致（どちらかがどちらかを含む）
 * 同じ列を複数フィールドに割り当てないよう、一度使った列は除外する。
 */
export function autoDetectMapping(headers: string[], fields: ImportFieldDef[]): Record<string, number | null> {
  const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};

  for (const field of fields) {
    const candidates = [field.label.toLowerCase(), ...field.aliases.map((a) => a.toLowerCase())];
    let foundIndex: number | null = null;

    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (used.has(i) || normalizedHeaders[i] === '') continue;
      if (candidates.includes(normalizedHeaders[i])) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === null) {
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (used.has(i) || normalizedHeaders[i] === '') continue;
        if (candidates.some((c) => normalizedHeaders[i].includes(c) || c.includes(normalizedHeaders[i]))) {
          foundIndex = i;
          break;
        }
      }
    }

    mapping[field.key] = foundIndex;
    if (foundIndex !== null) used.add(foundIndex);
  }

  return mapping;
}
