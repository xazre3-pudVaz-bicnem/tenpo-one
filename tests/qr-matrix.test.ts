import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { qrMatrix, QR_LOGO_LEVEL } from '@/lib/qr-matrix';
import { tableOrderUrl } from '@/lib/table-qr';

/**
 * 印刷用 QR（SVG）。2026-10-19 Ronnie「印刷するとぼやける」「QR の真ん中に TENPO ONE のロゴ」。
 * 真ん中のマークの下が真っ黒に写っても、ちゃんと読めることを確かめる（いちばん悪い場合）。
 */
const S = 6; // 1マスの画素
function decode(value: string, logo: boolean, fillHole: boolean) {
  const { total, margin, path, hole } = qrMatrix(value, { logo });
  const W = total * S;
  const data = new Uint8ClampedArray(W * W * 4).fill(255);
  const fill = (x: number, y: number, w: number, h: number) => {
    for (let yy = Math.round(y * S); yy < Math.round((y + h) * S); yy++)
      for (let xx = Math.round(x * S); xx < Math.round((x + w) * S); xx++) {
        const i = (yy * W + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  };
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) fill(Number(m[1]), Number(m[2]), Number(m[3]), 1);
  if (hole && fillHole) {
    // マーク（穴のまわり半マスは白）を真っ黒として描く
    const k = hole.end - hole.start;
    fill(margin + hole.start + 0.5, margin + hole.start + 0.5, k - 1, k - 1);
  }
  return jsQR(data, W, W)?.data ?? null;
}

describe('印刷用 QR（SVG のマス）', () => {
  const token = '5723ee95e21a4e45ac9a42fe258f4c1e203469a7963d4dffacf0ceed0b382b72';
  const urls = [
    tableOrderUrl('https://www.tenpo-one.com', 'full-moon', token),
    tableOrderUrl('https://www.tenpo-one.com', 'meat-crown-shin-yokohama', token),
    'https://www.tenpo-one.com/book/shunka-shinjuku-honten',
  ];

  it('ロゴなしはそのまま読める（誤り訂正 M・周りの白4マス）', () => {
    for (const u of urls) expect(decode(u, false, false)).toBe(u);
    expect(qrMatrix(urls[0]).hole).toBeNull();
    expect(qrMatrix(urls[0]).margin).toBe(4);
  });

  it('真ん中にロゴの穴（誤り訂正 Q・幅は約22%・ちょうど真ん中）。マークが真っ黒に写っても読める', () => {
    expect(QR_LOGO_LEVEL).toBe('Q');
    for (const u of urls) {
      const { total, margin, hole } = qrMatrix(u, { logo: true });
      expect(hole).not.toBeNull();
      const n = total - margin * 2;
      const k = hole!.end - hole!.start;
      expect(k / n).toBeGreaterThan(0.18);
      expect(k / n).toBeLessThan(0.27);
      expect(hole!.start).toBe(n - hole!.end); // 左右（上下）の余りが同じ
      expect(decode(u, true, false)).toBe(u);
      expect(decode(u, true, true)).toBe(u);
    }
  });
});
