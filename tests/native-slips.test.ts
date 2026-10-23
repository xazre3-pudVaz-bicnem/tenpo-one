import { describe, it, expect } from 'vitest';
import { NATIVE_SLIP_ACTION_TYPES, parseNativeSlipAction } from '@/lib/native-slips';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('ネイティブの伝票明細（2026-10-24）', () => {
  it('形', () => {
    expect(NATIVE_SLIP_ACTION_TYPES.length).toBe(4);
    expect(parseNativeSlipAction({ type: 'slipReceipt', orderId: 'x' }).ok).toBe(false);
    expect(parseNativeSlipAction({ type: 'slipReceipt', orderId: U1 }).ok).toBe(true);
  });
  it('返金：金額・方法・理由は必須。品目ごとも', () => {
    expect(parseNativeSlipAction({ type: 'slipRefund', orderId: U1, amount: 500, method: 'cash', reason: '味' }).ok).toBe(true);
    expect(parseNativeSlipAction({ type: 'slipRefund', orderId: U1, amount: 500, method: 'cash', reason: ' ' }).ok).toBe(false);
    expect(parseNativeSlipAction({ type: 'slipRefund', orderId: U1, amount: 0, method: 'cash', reason: 'a' }).ok).toBe(false);
    expect(parseNativeSlipAction({ type: 'slipRefund', orderId: U1, amount: 500, method: 'bitcoin', reason: 'a' }).ok).toBe(false);
    const r = parseNativeSlipAction({ type: 'slipRefund', orderId: U1, amount: 500, method: 'credit', reason: 'a', kind: 'void', items: [{ orderItemId: U2, quantity: 1, amount: 500, restock: true }] });
    expect(r.ok && r.action.type === 'slipRefund' && r.action.kind === 'void' && r.action.items === null).toBe(true);
  });
  it('領収書：宛名・但し書きは任意、分割は 2 枚以上', () => {
    const r = parseNativeSlipAction({ type: 'slipRyoshusho', orderId: U1, recipientName: ' 株式会社A ', purpose: '', splitAmounts: [1000] });
    expect(r.ok && r.action.type === 'slipRyoshusho' && r.action.recipientName === '株式会社A' && r.action.purpose === null && r.action.splitAmounts === null).toBe(true);
    expect(parseNativeSlipAction({ type: 'slipRyoshusho', orderId: U1, splitAmounts: [1000, 0] }).ok).toBe(false);
  });
});
