import { describe, it, expect } from 'vitest';
import { receiptToStarMarkup, drawerKickMarkup, testPrintMarkup } from '@/lib/receipt-markup';
import { baseReceipt as base } from './fixtures/receipt';



describe('receiptToStarMarkup', () => {
  it('主要な内容とMarkup命令を含む（80mm）', () => {
    const m = receiptToStarMarkup(base, { paperWidth: 80 });
    expect(m).toContain('[align: middle]');
    expect(m).toContain('[magnify: width 2; height 2]');
    expect(m).toContain('シュラスコテーブル FOGO');
    expect(m).toContain('シュラスコ食べ放題');
    expect(m).toContain('合計');
    expect(m).toContain('¥11,300');
    expect(m).toContain('照会番号 ORD-1001');
    expect(m.trimEnd().endsWith('[cut: feed; partial]')).toBe(true);
  });

  it('キャンセル品は出力しない', () => {
    const m = receiptToStarMarkup(base);
    expect(m).not.toContain('キャンセル品');
  });

  it('再発行・返金の見出しを出す', () => {
    const m = receiptToStarMarkup({ ...base, isReissue: true, isRefundReceipt: true });
    expect(m).toContain('※ 再発行');
    expect(m).toContain('※ 返金レシート');
  });

  it('Markup特殊文字（角括弧）を店名でエスケープする', () => {
    const m = receiptToStarMarkup({ ...base, storeName: 'A[B]C' });
    expect(m).toContain('A\\[B\\]C');
  });

  it('58mm指定でも生成できる', () => {
    const m = receiptToStarMarkup(base, { paperWidth: 58 });
    expect(m).toContain('合計');
  });
});

describe('drawerKickMarkup', () => {
  it('既定コマンドを返す', () => {
    expect(drawerKickMarkup('')).toBe('[drawer: 1]\n');
  });
  it('カスタムコマンドをそのまま使う', () => {
    expect(drawerKickMarkup('[drawer: 2]')).toBe('[drawer: 2]\n');
  });
});

describe('testPrintMarkup', () => {
  it('接続確認用の内容とカットを含む', () => {
    const m = testPrintMarkup({ storeName: 'FOGO', paperWidth: 80, issuedAt: '2026/08/11 20:00' });
    expect(m).toContain('CloudPRNT テスト印刷');
    expect(m).toContain('日本語テスト');
    expect(m).toContain('[cut: feed; partial]');
  });
});
