import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 卓のポップアップ（TableSheet）は外を押すと閉じる。ただし、その下に出す確認ダイアログ
 * （テーブルクリアの理由入力・席の時間）の中を押したときは閉じない（2026-09-28 店舗「理由をタップすると消える」）。
 */
describe('卓のポップアップの外を押したときだけ閉じる', () => {
  const src = readFileSync(new URL('../components/floor/table-sheet.tsx', import.meta.url), 'utf8');

  it('暗い所そのもの（e.target === e.currentTarget）を押したときだけ onClose', () => {
    expect(src).toContain('if (e.target === e.currentTarget) onClose();');
    expect(src).not.toContain('onClick={onClose} role="presentation"');
  });

  it('確認ダイアログはポップアップの外（同じ包みの中）に出している', () => {
    expect(src).toContain('<ConfirmDialog');
    expect(src).toContain('<SeatTimeDialog');
  });
});
