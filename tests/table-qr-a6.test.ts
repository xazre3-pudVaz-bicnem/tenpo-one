import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * テーブルQR：A6（A4 に4枚）と横名刺（A4 に10枚）。
 * 2026-09-29 Ronnie「A6・PDF でダウンロードして印刷するだけ」→ 2026-10-19 Ronnie「デザインを変えて（黒をやめる）。
 * 横名刺で全部の卓を A4 にまとめて印刷して切れるように。A6 も A4 にまとめて切れるように。高画質に。
 * 卓番号は真ん中。QR の真ん中に TENPO ONE のロゴ」
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('テーブルQR（A6・A4に4枚）', () => {
  const card = read('components/settings/table-qr-card.tsx');
  const page = read('app/app/settings/tables/qr-print/page.tsx');
  const pdf = read('components/settings/table-qr-pdf-button.tsx');

  it('カードは用紙そのものの大きさ（105mm × 148mm）。クリーム地＋テラコッタ（黒は使わない）、面は 5mm 内側', () => {
    expect(card).toContain('h-[148mm] w-[105mm]');
    expect(card).toContain('p-[5mm]');
    expect(card).toContain('bg-[#F7F5F0]');
    expect(card).toContain('bg-[#BC5940]');
    expect(card).not.toContain('bg-[#292725]');
    expect(card).toContain('[print-color-adjust:exact]');
    expect(card).toContain('data-qr-card');
  });

  it('卓番号は真ん中、QR は SVG で真ん中に TENPO ONE のマーク', () => {
    expect(card).toContain('TABLE');
    expect(card).toContain('items-center');
    expect(card).toContain('text-center');
    expect(card).toMatch(/<QrSvg value=\{url\} sizeMm=\{56\} logo/);
  });

  it('印刷は A4・余白なしで A6 を 2×2、PDF も A4 に4枚（A6 の紙に1枚ずつも残す）', () => {
    expect(page).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(page).toContain('<A4CutSheets cardW={105} cardH={148} cols={2} rows={2}>');
    expect(page).toContain('<TableQrCard');
    expect(page).toContain("layout={a6 ? 'a4-4up' : 'a4-business-card'}");
    expect(page).toContain('PDFでダウンロード（A4に4枚）');
    expect(page).toContain('テーブルQR_A6.pdf');
    // 用紙は既定 A6（店舗名刺の A4 シートだけ page="a4"。A4 4面のときだけ sheet が a4 になる）
    expect(pdf).toMatch(/page = ["']a6["']/);
    expect(pdf).toMatch(/layout = ["']one-per-page["']/);
    expect(pdf).toContain('const sheet = fourUp ? "a4" : page');
    expect(pdf).toContain('format: pageFormat');
    expect(pdf).toContain('const pageFormat: string | number[] = card ? [BC_H, BC_W] : sheet;');
    expect(pdf).toContain('card ? [BC_W, BC_H] : [105, 148]');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], 0, 0, pw, ph/);
  });

  it('PDF の A4 4枚は A6（105×148mm）をそのまま 2×2・点線の切り取り線・4卓ごとに改ページ', () => {
    expect(pdf).toContain('const CW = 105');
    expect(pdf).toContain('const CH = 148');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], x, y, CW, CH/);
    expect(pdf).toContain('pdf.line(0, TOP4 + CH, pw, TOP4 + CH)');
    expect(pdf).toContain('if (i > 0 && slot === 0) pdf.addPage("a4", "portrait")');
  });
});

describe('テーブルQR（横名刺・A4に10枚）', () => {
  const bc = read('components/settings/table-qr-business-card.tsx');
  const page = read('app/app/settings/tables/qr-print/page.tsx');
  const pdf = read('components/settings/table-qr-pdf-button.tsx');
  const sheets = read('components/settings/a4-cut-sheets.tsx');

  it('カードは横名刺（91mm × 55mm）・クリーム地＋テラコッタ・卓番号は真ん中・TENPO ONE は下の真ん中', () => {
    expect(bc).toContain('data-qr-card-bc');
    expect(bc).toContain('h-[55mm] w-[91mm]');
    expect(bc).toContain('ご注文はスマホから');
    expect(bc).toContain('ORDER FROM YOUR PHONE');
    expect(bc).toContain('bg-[#F7F5F0]');
    expect(bc).toContain('bg-[#BC5940]');
    expect(bc).toContain('justify-between');
    expect(bc).toContain('TENPO</span> <span className="text-[#BC5940]">ONE');
    expect(bc).toMatch(/<QrSvg value=\{url\} sizeMm=\{37\} logo/);
  });

  it('画面と印刷は A4 に 2×5（切り取り線・トンボ入り）。ふつうは名刺、?size=a6 で A6', () => {
    expect(page).toContain('<A4CutSheets cardW={91} cardH={55} cols={2} rows={5}');
    expect(page).toContain('<TableQrBusinessCard');
    expect(page).toContain("const a6 = size === 'a6'");
    expect(page).toContain('PDFでダウンロード（A4に10枚）');
    expect(page).toContain('名刺サイズ（横・A4に10枚）');
    expect(sheets).toContain('border-dashed');
    expect(sheets).toContain('トンボ');
    expect(sheets).toContain('not-last:[break-after:page]');
  });

  it('PDF は A4 に 2列×5段（91/55mm）・10卓ごとに改ページ・点線とトンボ', () => {
    expect(pdf).toContain('[data-qr-card-bc]');
    expect(pdf).toContain('const BC_W = 91');
    expect(pdf).toContain('const BC_H = 55');
    expect(pdf).toContain('const BC_COLS = 2');
    expect(pdf).toContain('const BC_ROWS = 5');
    expect(pdf).toContain('const slot = i % BC_PER_PAGE');
    expect(pdf).toContain('if (i > 0 && slot === 0) pdf.addPage("a4", "portrait")');
    expect(pdf).toMatch(/pdf\.addImage\(png, ["']PNG["'], x, y, BC_W, BC_H/);
    expect(pdf).toContain('pdf.setLineDashPattern([1.5, 1.5], 0)');
    expect(pdf).toContain('pdf.line(x, BC_MY - 9, x, BC_MY - 2)');
  });

  it('高画質：PDF の画像は約576dpi（pixelRatio 6）、1600万画素を超えないように下げる', () => {
    expect(pdf).toContain('const MAX_PIXEL_RATIO = 6');
    expect(pdf).toContain('const MAX_PIXELS = 16_000_000');
    expect(pdf).not.toContain('pixelRatio: 3');
  });
});
