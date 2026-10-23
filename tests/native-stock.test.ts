import { describe, it, expect } from 'vitest';
import { parseNativeStockAction } from '@/lib/native-stock';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('ネイティブの在庫設定（2026-10-24）', () => {
  it('保存：食数は 0 以上の整数か null（在庫管理しない）', () => {
    expect(parseNativeStockAction({ type: 'stockSave', entries: [{ itemId: U1, limit: 5 }, { itemId: U1, limit: null }] }).ok).toBe(true);
    expect(parseNativeStockAction({ type: 'stockSave', entries: [{ itemId: U1, limit: -1 }] }).ok).toBe(false);
    expect(parseNativeStockAction({ type: 'stockSave', entries: [{ itemId: 'x', limit: 1 }] }).ok).toBe(false);
  });
  it('印刷：1 品以上', () => {
    expect(parseNativeStockAction({ type: 'stockPrint', lines: [] }).ok).toBe(false);
    expect(parseNativeStockAction({ type: 'stockPrint', lines: [{ name: '唐揚げ', remaining: 3 }] }).ok).toBe(true);
  });
});
