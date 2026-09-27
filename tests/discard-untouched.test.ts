import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 「注文」で伝票を立てたが品を入れずに画面を離れたら、その卓は ¥0 で残らない（2026-09-28 Ronnie）。
 * サーバー側の判定（品が1つも入ったことがない・支払なし・会計前だけ消す）と、画面側の呼び出し口を固定する。
 */
describe('品を入れずに離れた伝票は無かったことにする', () => {
  const lib = readFileSync(new URL('../lib/discard-untouched-order.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../components/pos/pos-screen.tsx', import.meta.url), 'utf8');

  it('サーバー：品が1つでも入ったことがある伝票・支払のある伝票・会計前でない伝票は消さない', () => {
    expect(lib).toContain("if (order.status !== 'open') return");
    expect(lib).toContain("if ((anyItems ?? 0) > 0) return");
    expect(lib).toContain("if ((payments ?? 0) > 0) return");
    // 取消は「まだ open のとき」だけ（同時に2回呼ばれても1回だけ効く）
    expect(lib).toContain(".eq('status', 'open')");
    // 卓は空席へ・予約は取消
    expect(lib).toContain("current_status: 'available'");
    expect(lib).toContain("status: 'cancelled', cancel_reason: '注文せずに戻った（自動）'");
  });

  it('画面：品が入っていなければ 戻るボタン・unmount・pagehide で消す（カートだけは決定していない扱い）', () => {
    expect(screen).toContain('untouchedRef.current = items.length === 0;');
    expect(screen).toContain("navigator.sendBeacon('/api/pos/discard-untouched'");
    expect(screen).toContain('if (untouchedRef.current) void discardUntouchedOrderAction(orderId)');
  });
});
