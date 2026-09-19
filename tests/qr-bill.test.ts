import { describe, it, expect } from 'vitest';
import { selectQrOrdersToPrint, QR_BILL_BATCH_DELAY_MS, QR_BILL_WINDOW_MS } from '@/lib/qr-bill';

const now = 1_800_000_000_000;

describe('selectQrOrdersToPrint（QR注文のお会計伝票を出すか）', () => {
  it('まだ一度も出していない注文は、最後の追加から3秒経てば出す', () => {
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - 5_000] }], now)).toEqual(['a']);
  });

  it('最後の追加から3秒未満なら待つ（1回の注文で複数品が入っても1枚にまとめる）', () => {
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - 10_000, now - 1_000] }], now)).toEqual([]);
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - 10_000, now - QR_BILL_BATCH_DELAY_MS] }], now)).toEqual(['a']);
  });

  it('前回の伝票以降に追加が無ければ出さない（ポーリングのたびに重複しない）', () => {
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - 60_000], lastSlipAt: now - 30_000 }], now)).toEqual([]);
  });

  it('前回の伝票の後に追加注文が入れば、もう一度（最新の全明細で）出す', () => {
    expect(
      selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - 60_000, now - 5_000], lastSlipAt: now - 30_000 }], now)
    ).toEqual(['a']);
  });

  it('明細が無い注文・古すぎる注文は出さない', () => {
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [] }], now)).toEqual([]);
    expect(selectQrOrdersToPrint([{ orderId: 'a', itemAddedAt: [now - QR_BILL_WINDOW_MS - 1] }], now)).toEqual([]);
  });

  it('複数の注文を独立に判定する', () => {
    const r = selectQrOrdersToPrint(
      [
        { orderId: 'a', itemAddedAt: [now - 5_000] },
        { orderId: 'b', itemAddedAt: [now - 1_000] },
        { orderId: 'c', itemAddedAt: [now - 5_000], lastSlipAt: now - 4_000 },
      ],
      now
    );
    expect(r).toEqual(['a']);
  });
});
