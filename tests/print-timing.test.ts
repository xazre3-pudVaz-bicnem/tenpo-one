import { expect, it } from 'vitest';
import { printTimingLabel } from '../lib/print-timing';
it('separates cloud preparation from Bluetooth acknowledgement without inventing paper-start timing', () => {
  expect(printTimingLabel(100, 2100, 3200)).toBe('準備 2.00秒 / Bluetooth送信・応答 1.10秒 / 合計 3.10秒');
  expect(printTimingLabel(10, 20, 30)).toBe('準備 0.01秒 / Bluetooth送信・応答 0.01秒 / 合計 0.02秒');
});
