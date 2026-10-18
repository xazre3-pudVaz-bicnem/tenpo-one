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
    expect(card).toContain('bg-[#292725]');
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
    // 用紙は既定 A6（店舗名刺の A4 シートだけ page="a4"。A4 4面のときだけ sheet が a4 になる）
    expect(pdf).toMatch(/page = ["']a6["']/);
    expect(pdf).toMatch(/layout = ["']one-per-page["']/);
    expect(pdf).toContain('const sheet = fourUp ? "a4" : page');
    expect(pdf).toContain('format: pageFormat');
    expect(pdf).toContain('const pageFormat: string | number[] = card ? [BC_H, BC_W] : sheet;');
    expect(pdf).toContain('card ? [BC_W, BC_H] : [105, 148]');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], 0, 0, pw, ph/);
  });

  it('A4 に4面＋切り取り線（2026-10-16 Ronnie「a4 paper ma katna milne tarikale pdf」）', () => {
    // A4 を4等分（105 × 148.5mm）に貼り、点線の切り取り線を縦横1本ずつ
    expect(pdf).toContain('const CW = pw / 2');
    expect(pdf).toContain('const CH = ph / 2');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], x, y, CW, CH/);
    expect(pdf).toContain('pdf.setLineDashPattern([2, 2], 0)');
    expect(pdf).toContain('pdf.line(CW, 0, CW, ph)');
    expect(pdf).toContain('pdf.line(0, CH, pw, CH)');
    // 4卓ごとに改ページ
    expect(pdf).toContain('if (i > 0 && slot === 0) pdf.addPage("a4", "portrait")');
    // 印刷ページでは A4・4面がいちばん上（ふつうはこれ）、A6 も残す
    expect(page).toContain('layout="a4-4up"');
    expect(page).toContain('PDFでダウンロード（A4・4面）');
    expect(page).toContain('テーブルQR_A6.pdf');
  });
});

describe('テーブルQR（名刺サイズ・A4に10面）', () => {
  // 2026-10-17 Ronnie「名刺サイズ（91×55mm）を A4 に 2列×5段＝10面の PDF」
  const bc = read('components/settings/table-qr-business-card.tsx');
  const page = read('app/app/settings/tables/qr-print/page.tsx');
  const pdf = read('components/settings/table-qr-pdf-button.tsx');

  it('カードは名刺の大きさ（91mm × 55mm）・QR は 37mm・TENPO ONE のロゴ入り', () => {
    expect(bc).toContain('data-qr-card-bc');
    expect(bc).toContain('h-[55mm] w-[91mm]');
    expect(bc).toContain('h-[37mm] w-[37mm]');
    expect(bc).toContain('/logo-mark.png');
    expect(bc).toContain('ご注文はスマホから');
    expect(bc).toContain('ORDER FROM YOUR PHONE');
    expect(bc).toContain('bg-[#F7F5F0]');
    expect(bc).toContain('bg-[#BC5940]');
  });

  it('PDF は A4 に 2列×5段（91/55mm）・10卓ごとに改ページ・点線の切り取り線', () => {
    expect(pdf).toContain('[data-qr-card-bc]');
    expect(pdf).toContain('const BC_W = 91');
    expect(pdf).toContain('const BC_H = 55');
    expect(pdf).toContain('const BC_COLS = 2');
    expect(pdf).toContain('const BC_ROWS = 5');
    expect(pdf).toContain('const slot = i % BC_PER_PAGE');
    expect(pdf).toContain('if (i > 0 && slot === 0) pdf.addPage("a4", "portrait")');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], x, y, BC_W, BC_H/);
    expect(pdf).toContain('pdf.setLineDashPattern([2, 2], 0)');
  });

  it('印刷ページに「名刺サイズ・A4に10面」のボタン（A4・4面の右）と画面外のカード', () => {
    expect(page).toContain('layout="a4-business-card"');
    expect(page).toContain('PDFでダウンロード（名刺サイズ・A4に10面）');
    expect(page).toContain('テーブルQR_名刺サイズ.pdf');
    expect(page).toContain('<TableQrBusinessCard');
    expect(page.indexOf('PDFでダウンロード（A4・4面）')).toBeLessThan(page.indexOf('PDFでダウンロード（名刺サイズ・A4に10面）'));
  });
});
