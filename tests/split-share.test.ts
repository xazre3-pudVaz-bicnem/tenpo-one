import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareAmounts, sharedName, splitPrintedQty } from '@/lib/split-share';

/**
 * 別々会計：同じ品を何人かで食べたとき（2026-10-20 高田馬場「同じ品を3人で食べると別々会計できない」）。
 */
describe('1つの品を何人かで分ける', () => {
  it('金額は人数で分けて、合計は元と同じ（端数は前から1円ずつ）', () => {
    expect(shareAmounts(3000, 3)).toEqual([1000, 1000, 1000]);
    expect(shareAmounts(1000, 3)).toEqual([334, 333, 333]);
    expect(shareAmounts(1001, 2)).toEqual([501, 500]);
    for (const [p, n] of [[1, 2], [999, 4], [12345, 6], [500, 10]] as const) {
      const s = shareAmounts(p, n);
      expect(s).toHaveLength(n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(p);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    }
  });
  it('人数は2〜10人', () => {
    expect(() => shareAmounts(1000, 1)).toThrow();
    expect(() => shareAmounts(1000, 11)).toThrow();
    expect(() => shareAmounts(1000, 2.5)).toThrow();
  });
  it('名前は「品名（1/3）」', () => {
    expect(sharedName('前菜の盛り合わせ', 3)).toBe('前菜の盛り合わせ（1/3）');
  });
  it('伝票分割で厨房へ伝えた数量は合計を変えない（厨房に取消・追加の伝票が出ない）', () => {
    expect(splitPrintedQty(3, 1)).toEqual({ stay: 2, moved: 1 });
    expect(splitPrintedQty(3, 3)).toEqual({ stay: 0, moved: 3 });
    // まだ伝えていない分があるとき：移す分から先に「伝えた」にする。合計は同じ
    expect(splitPrintedQty(1, 2)).toEqual({ stay: 0, moved: 1 });
    expect(splitPrintedQty(0, 1)).toEqual({ stay: 0, moved: 0 });
    // 取消の伝票がまだ出ていない（伝えた数＞今の数）ときも差は残す
    expect(splitPrintedQty(5, 1)).toEqual({ stay: 4, moved: 1 });
  });
});

describe('別々会計の画面・サーバー', () => {
  const ui = readFileSync(new URL('../components/pos/checkout-dialog.tsx', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../app/app/pos/actions.ts', import.meta.url), 'utf8');
  it('同じ品が1行（例：ランチ×3）でも別々会計を押せる（行の数ではなく品の数で見る）', () => {
    expect(ui).not.toContain('splitLines.length < 2');
    expect(ui).toContain('const canSplit = splitQty >= 2 ||');
    expect(ui).toContain('disabled={terminalBlocking || !splitOrderAction || !canSplit}');
  });
  it('「分ける」で 2〜6人を選ぶと、その品が人数分の「（1/n）」になる', () => {
    expect(ui).toContain('[2, 3, 4, 5, 6].map((n)');
    expect(ui).toContain('divideOrderItemAction(order.id, lineId, parts)');
    expect(actions).toContain('export async function divideOrderItem(orderId: string, orderItemId: string, parts: number)');
    expect(actions).toContain("const shares = shareAmounts(line.unit_price, parts);");
    // 厨房へは伝えたまま（新しい伝票・取消の伝票を出さない）
    expect(actions).toContain('kitchen_printed_qty: 1,');
    expect(actions).toContain('kitchen_printed_qty: printed.stay,');
    expect(actions).toContain('kitchen_printed_qty: printed.moved,');
  });
});
