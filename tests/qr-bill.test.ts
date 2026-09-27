import { describe, it, expect } from 'vitest';
import { selectCheckoutBillsToPrint, CHECKOUT_BILL_WINDOW_MS } from '@/lib/qr-bill';

const now = 1_800_000_000_000;

describe('selectCheckoutBillsToPrint（お客様が「お会計」を押したときだけお会計伝票を出す。2026-09-28）', () => {
  it('「お会計」のあとまだ出していなければ出す', () => {
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - 5_000, hasItems: true }], now)).toEqual(['a']);
  });

  it('「お会計」のあとに一度出していれば出さない（ポーリングのたびに重複しない・追加注文でも出さない）', () => {
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - 60_000, hasItems: true, lastSlipAt: now - 30_000 }], now)).toEqual([]);
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - 60_000, hasItems: true, lastSlipAt: now - 60_000 }], now)).toEqual([]);
  });

  it('前の伝票より後にもう一度「お会計」を押せば、また1枚出す', () => {
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - 5_000, hasItems: true, lastSlipAt: now - 30_000 }], now)).toEqual(['a']);
  });

  it('明細が無い注文・古すぎる「お会計」は出さない', () => {
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - 5_000, hasItems: false }], now)).toEqual([]);
    expect(selectCheckoutBillsToPrint([{ orderId: 'a', requestedAt: now - CHECKOUT_BILL_WINDOW_MS - 1, hasItems: true }], now)).toEqual([]);
  });

  it('複数の注文を独立に判定する', () => {
    const r = selectCheckoutBillsToPrint(
      [
        { orderId: 'a', requestedAt: now - 5_000, hasItems: true },
        { orderId: 'b', requestedAt: now - 5_000, hasItems: false },
        { orderId: 'c', requestedAt: now - 5_000, hasItems: true, lastSlipAt: now - 4_000 },
      ],
      now
    );
    expect(r).toEqual(['a']);
  });
});
