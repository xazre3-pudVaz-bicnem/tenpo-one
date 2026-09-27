/**
 * 印字用の行（LayoutLine）を、画面で「レシートそっくり」に出すための行に分ける（純粋関数・テスト対象）。
 * 2026-09-28 Ronnie「iPad のレジクローズにレジ精算のデータをレシートみたいに全部見えるように」。
 * 印字は桁でそろえた文字列だが、画面のフォントでは日本語の幅がずれるので、左（名前）・中（件数）・右（金額）に分けて
 * flex でそろえる。2つ以上の空白で区切られた所を列の境目とみなす。
 */
import type { LayoutLine } from './kitchen-ticket';

export type PaperRow =
  | { t: 'big'; text: string }
  | { t: 'center'; text: string }
  | { t: 'text'; text: string }
  | { t: 'kv'; label: string; value: string }
  | { t: 'kcv'; label: string; count: string; value: string }
  | { t: 'solid' }
  | { t: 'dotted' }
  | { t: 'blank' };

export function paperRowsFromLines(lines: LayoutLine[]): PaperRow[] {
  const out: PaperRow[] = [];
  for (const l of lines) {
    for (const text of l.text.split('\n')) {
      const trimmed = text.trim();
      if (trimmed === '') {
        out.push({ t: 'blank' });
        continue;
      }
      if (/^_+$/.test(trimmed)) {
        out.push({ t: 'solid' });
        continue;
      }
      if (/^(- )+-?$/.test(trimmed)) {
        out.push({ t: 'dotted' });
        continue;
      }
      if (l.size === 'large') {
        out.push({ t: 'big', text: trimmed });
        continue;
      }
      if (l.align === 'center') {
        out.push({ t: 'center', text: trimmed });
        continue;
      }
      const lead = text.length - text.trimStart().length;
      const indent = ' '.repeat(lead);
      const cells = trimmed.split(/\s{2,}/).filter((c) => c !== '');
      if (cells.length === 3 && !/^税率/.test(trimmed)) out.push({ t: 'kcv', label: indent + cells[0], count: cells[1], value: cells[2] });
      else if (cells.length === 3) out.push({ t: 'kv', label: `${cells[0]}  ${cells[1]}`, value: cells[2] });
      else if (cells.length === 2) out.push({ t: 'kv', label: indent + cells[0], value: cells[1] });
      else out.push({ t: 'text', text: text.replace(/\s+$/, '') });
    }
  }
  return out;
}
