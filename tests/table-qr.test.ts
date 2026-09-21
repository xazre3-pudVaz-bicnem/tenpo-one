import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { TABLE_QR_OPTIONS, tableOrderUrl, tableQrDataUrl } from '@/lib/table-qr';

describe('テーブルのお客様QR', () => {
  const token = '5723ee95e21a4e45ac9a42fe258f4c1e203469a7963d4dffacf0ceed0b382b72';

  it('注文ページの URL（origin の末尾のスラッシュは付けない）', () => {
    expect(tableOrderUrl('https://www.tenpo-one.com', 'full-moon', token)).toBe(
      `https://www.tenpo-one.com/order/full-moon/${token}`
    );
    expect(tableOrderUrl('https://www.tenpo-one.com/', 'full-moon', token)).toBe(
      `https://www.tenpo-one.com/order/full-moon/${token}`
    );
  });

  it('周りの白は規格どおり4マス・誤り訂正 M（小さく印刷しても読める細かさ）', async () => {
    expect(TABLE_QR_OPTIONS).toEqual({ errorCorrectionLevel: 'M', margin: 4 });
    const url = tableOrderUrl('https://www.tenpo-one.com', 'full-moon', token);
    const svg = await QRCode.toString(url, { ...TABLE_QR_OPTIONS, type: 'svg' });
    const size = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size;
    // viewBox は「QR のマス数 + 両側4マス」
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    // 長い URL でも version 7（45マス）以下＝5cm 角で1マス約1mm
    expect(size).toBeLessThanOrEqual(45);
  });

  it('画像は PNG の data URL', async () => {
    const dataUrl = await tableQrDataUrl(tableOrderUrl('https://www.tenpo-one.com', 'full-moon', token), 480);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
