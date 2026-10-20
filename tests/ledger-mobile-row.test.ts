import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * スマホの店舗台帳（2026-10-20 Ronnie）：上のボタン6つを1行に／下の色の説明・操作の説明はスマホでは出さない
 */
describe('スマホの店舗台帳', () => {
  it('ボタン6つを1行に：スマホはアイコンの下に小さい字・横いっぱい。パソコン・iPad は今まで通り', () => {
    const header = readFileSync(new URL('../components/reservations/ledger-header.tsx', import.meta.url), 'utf8');
    expect(header).toContain("'inline-flex h-11 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-[9px] bg-royal px-1 text-[10px]");
    expect(header).toContain('sm:flex-row sm:gap-1.5 sm:px-3.5 sm:text-[14px]');
    expect(header).toContain('className="flex w-full flex-nowrap items-center gap-1.5 sm:ml-auto sm:w-auto sm:flex-wrap sm:gap-2"');
  });
  it('下の説明（色の意味・操作）はスマホでは出さない。最終更新だけ', () => {
    const board = readFileSync(new URL('../components/reservations/schedule-board.tsx', import.meta.url), 'utf8');
    expect(board).toContain('<div className="hidden flex-wrap items-center gap-x-3 gap-y-1 font-medium text-ink-2 sm:flex">');
  });
});
