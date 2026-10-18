import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MEISHI_W, MEISHI_H, MEISHI_COLS, MEISHI_ROWS } from '@/components/settings/booking-meishi';

/** 2026-09-30 Ronnie「店舗名刺としてプリントする。A4 に名刺サイズが入るだけ。切る線も全部。立名刺」 */
describe('店舗名刺（横名刺。2026-10-19 予約QRと同じデザイン）', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('横名刺 91×55mm を A4（210×297mm）に 2×5＝10枚、余白が残る', () => {
    expect([MEISHI_W, MEISHI_H]).toEqual([91, 55]);
    expect(MEISHI_W * MEISHI_COLS).toBeLessThanOrEqual(210 - 20);
    expect(MEISHI_H * MEISHI_ROWS).toBeLessThanOrEqual(297 - 20);
    expect(MEISHI_COLS * MEISHI_ROWS).toBe(10);
  });

  it('切り取り線（点線）とトンボ、A4 で印刷・PDF', () => {
    const sheet = read('components/settings/booking-meishi.tsx');
    expect(sheet).toContain('border-dashed');
    expect(sheet).toContain('data-qr-card');
    // 中の名刺は予約QRカードと同じ。1枚ずつの印（data-qr-card）は付けない＝PDF はシート1ページ
    expect(sheet).toContain('<BookingQrCard');
    expect(sheet).toContain('printable={false}');
    const page = read('app/app/settings/store/business-cards/page.tsx');
    expect(page).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(page).toContain('page="a4"');
    expect(read('components/settings/booking-qr-download.tsx')).toContain('店舗名刺としてプリントする');
  });
});
