import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** テーブルQR：A6・1卓1枚・黒と紫・PDF でダウンロードして印刷するだけ（2026-09-29 Ronnie） */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('テーブルQR（A6）', () => {
  const card = read('components/settings/table-qr-card.tsx');
  const page = read('app/app/settings/tables/qr-print/page.tsx');
  const pdf = read('components/settings/table-qr-pdf-button.tsx');

  it('カードは用紙そのものの大きさ（105mm × 148mm）、暗い枠は 5mm 内側、印刷でも色が出る', () => {
    expect(card).toContain('h-[148mm] w-[105mm]');
    expect(card).toContain('p-[5mm]');
    expect(card).toContain('bg-[#15121a]');
    expect(card).toContain('[print-color-adjust:exact]');
    expect(card).toContain('data-qr-card');
  });

  it('QR は白地（読み取りやすさ優先）', () => {
    expect(card).toMatch(/bg-white p-\[2mm\]/);
  });

  it('印刷は A6・余白なし、PDF は A6 の1枚1ページ', () => {
    expect(page).toContain("@page { size: A6 portrait; margin: 0; }");
    expect(page).toContain('<TableQrCard');
    expect(page).toContain('<TableQrPdfButton');
    expect(pdf).toMatch(/format: ["']a6["']/);
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], 0, 0, 105, 148/);
  });
});
