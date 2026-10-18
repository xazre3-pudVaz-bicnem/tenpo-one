import { describe, it, expect } from 'vitest';
import {
  canHandyCancel,
  extendedStayMinutes,
  handyCancelSecondsLeft,
  HANDY_CANCEL_WINDOW_MS,
  HANDY_MEMO_MAX,
  normalizeHandyMemo,
} from '@/lib/handy-cancel';
import { setCartLineMemo, type HandyCartLine } from '@/components/handy/logic';

describe('ハンディの取消・時間延長・メモ（2026-10-18 Ronnie）', () => {
  const now = 1_000_000_000;

  it('送ってから5分以内だけ − で取り消せる', () => {
    expect(canHandyCancel(now - 60_000, now)).toBe(true);
    expect(canHandyCancel(now - HANDY_CANCEL_WINDOW_MS, now)).toBe(true);
    expect(canHandyCancel(now - HANDY_CANCEL_WINDOW_MS - 60_000, now)).toBe(false);
    expect(canHandyCancel(null, now)).toBe(false);
    expect(handyCancelSecondsLeft(now - 60_000, now)).toBe(240);
    expect(handyCancelSecondsLeft(now - 10 * 60_000, now)).toBe(0);
  });

  it('延長後の時間は 15分〜8時間に収める', () => {
    expect(extendedStayMinutes(120, 30)).toBe(150);
    expect(extendedStayMinutes(470, 60)).toBe(480);
    expect(extendedStayMinutes(119.6, 30)).toBe(150);
  });

  it('メモは空白をそろえ、長さを切る。空なら null', () => {
    expect(normalizeHandyMemo('  氷なし　 辛さ控えめ ')).toBe('氷なし 辛さ控えめ');
    expect(normalizeHandyMemo('   ')).toBeNull();
    expect(normalizeHandyMemo(5)).toBeNull();
    expect([...(normalizeHandyMemo('あ'.repeat(100)) ?? '')]).toHaveLength(HANDY_MEMO_MAX);
  });

  it('カートの行のメモを入れる・消す', () => {
    const cart = [
      { key: 'a', menuItemId: 'a', name: 'A', nameEn: null, unitPrice: 100, quantity: 1, optionItemIds: [], optionLabel: '' },
      { key: 'b', menuItemId: 'b', name: 'B', nameEn: null, unitPrice: 100, quantity: 1, optionItemIds: [], optionLabel: '' },
    ] as HandyCartLine[];
    const withMemo = setCartLineMemo(cart, 'a', '氷なし');
    expect(withMemo[0].memo).toBe('氷なし');
    expect(withMemo[1].memo).toBeUndefined();
    expect(setCartLineMemo(withMemo, 'a', '  ')[0].memo).toBeNull();
  });
});
