import { describe, it, expect } from 'vitest';
import { isNativeCashActionType, NATIVE_CASH_ACTION_TYPES, parseDenominations, parseNativeCashAction, sumNativeDenominations } from '@/lib/native-cash';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('ネイティブのレジ開局・レジクローズの操作（2026-10-24）', () => {
  it('知らない形は受け付けない', () => {
    expect(parseNativeCashAction(null).ok).toBe(false);
    expect(parseNativeCashAction({ type: 'ledgerSeat' }).ok).toBe(false);
    expect(isNativeCashActionType('cashOpen')).toBe(true);
    expect(NATIVE_CASH_ACTION_TYPES.length).toBe(5);
  });

  it('金種はレジのトレイの金種だけ・枚数は 0 以上の整数・1 つは入れる', () => {
    expect(parseDenominations({ '1': 0 })).toEqual({ '1': 0 });
    expect(parseDenominations({})).toBeNull();
    expect(parseDenominations({ '2': 1 })).toBeNull();
    expect(parseDenominations({ '100': -1 })).toBeNull();
    expect(parseDenominations({ '100': 1.5 })).toBeNull();
    expect(sumNativeDenominations({ '1000': 3, '100': 5, '1': 2 })).toBe(3502);
  });

  it('開局・クローズ・再印刷・ログアウト', () => {
    const o = parseNativeCashAction({ type: 'cashOpen', registerId: U1, denominations: { '1000': 10 }, reason: ' ', clerkName: '山田' });
    expect(o.ok).toBe(true);
    if (o.ok && o.action.type === 'cashOpen') {
      expect(o.action.reason).toBeNull();
      expect(o.action.clerkName).toBe('山田');
    }
    expect(parseNativeCashAction({ type: 'cashOpen', registerId: 'x', denominations: { '1000': 10 } }).ok).toBe(false);
    expect(parseNativeCashAction({ type: 'cashClose', sessionId: U1, denominations: {} }).ok).toBe(false);
    expect(parseNativeCashAction({ type: 'cashClose', sessionId: U1, denominations: { '10000': 2 }, reason: '釣銭ミス' }).ok).toBe(true);
    expect(parseNativeCashAction({ type: 'cashReprint', sessionId: U1 }).ok).toBe(true);
    expect(parseNativeCashAction({ type: 'cashSignOut' }).ok).toBe(true);
  });
});
