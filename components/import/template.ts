import { toCsv } from '@/lib/csv';
import type { ImportType } from './types';
import { templateHeaders } from './field-defs';

/** テンプレートCSV（ヘッダー行のみ）をdata URIとして生成する。ダウンロードリンクのhrefにそのまま使う */
export function buildTemplateDataUri(type: ImportType): string {
  const csv = toCsv(templateHeaders(type), []);
  const bytes = new TextEncoder().encode(csv);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:text/csv;charset=utf-8;base64,${btoa(binary)}`;
}
