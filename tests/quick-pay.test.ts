import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  quickPayProblem,
  QUICK_PAY_MAX_AMOUNT,
  QUICK_PAY_MAX_LINES,
  QUICK_PAY_MAX_QUANTITY,
  QUICK_PAY_TAX_RATE,
} from '@/lib/quick-pay';
import { NAV_TILES } from '@/lib/nav';

/** 2026-09-30 Ronnie「即会計：電卓のレジのように金額だけで会計。メニュー選択もできる。ほかの会計は同じ」 */
describe('即会計', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('左メニュー：店舗台帳のすぐ下', () => {
    const hrefs = NAV_TILES.map((t) => t.href);
    expect(hrefs.indexOf('/app/quick-pay')).toBe(hrefs.indexOf('/app/reservations') + 1);
  });

  it('金額のチェック（単価 × 個数）', () => {
    const l = (amount: number, quantity = 1) => ({ amount, quantity });
    expect(quickPayProblem([l(1200), l(800)])).toBeNull();
    expect(quickPayProblem([l(530, 2), l(300, 3), l(790, 3)])).toBeNull();
    expect(quickPayProblem([])).toBeNull();
    expect(quickPayProblem([l(0)])).not.toBeNull();
    expect(quickPayProblem([l(-100)])).not.toBeNull();
    expect(quickPayProblem([l(12.5)])).not.toBeNull();
    expect(quickPayProblem([l(QUICK_PAY_MAX_AMOUNT + 1)])).not.toBeNull();
    expect(quickPayProblem([l(500, 0)])).not.toBeNull();
    expect(quickPayProblem([l(500, QUICK_PAY_MAX_QUANTITY + 1)])).not.toBeNull();
    expect(quickPayProblem(Array.from({ length: QUICK_PAY_MAX_LINES + 1 }, () => l(100)))).not.toBeNull();
  });

  it('明細は 単価×個数（line_total）・印刷済み数量も個数', () => {
    const src = read('app/app/quick-pay/actions.ts');
    expect(src).toContain('line_total: amount * quantity');
    expect(src).toContain('kitchen_printed_qty: quantity');
  });

  it('入れた金額は税込・10%（選ばない）', () => {
    expect(QUICK_PAY_TAX_RATE).toBe(10);
    const src = read('app/app/quick-pay/actions.ts');
    expect(src).toContain('tax_included: true');
    expect(src).toContain('menu_item_id: null');
  });

  it('金額の明細は厨房に出さない（送信済み・印刷済みで入れる／KDS・厨房伝票はメニューの商品だけ）', () => {
    const src = read('app/app/quick-pay/actions.ts');
    expect(src).toContain("kitchen_status: 'served'");
    expect(read('app/app/kitchen/page.tsx')).toContain('.filter((r) => r.menu_item_id != null)');
    expect(read('supabase/migrations/00093_quick_pay_no_kitchen.sql')).toContain('and oi.menu_item_id is not null');
  });

  it('会計はいつもの会計画面（checkout=1）', () => {
    expect(read('components/pos/quick-pay-screen.tsx')).toContain('&checkout=1');
  });
});
