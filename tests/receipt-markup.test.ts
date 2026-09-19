import { describe, it, expect } from 'vitest';
import {
  receiptToStarMarkup,
  ryoshushoToStarMarkup,
  orderSlipMarkup,
  drawerKickMarkup,
  testPrintMarkup,
} from '@/lib/receipt-markup';
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

describe('ryoshushoToStarMarkup（領収書）', () => {
  it('見出しが「領収書」で、レシートとは別レイアウトになる', () => {
    const m = ryoshushoToStarMarkup(base, { paperWidth: 80 });
    expect(m).toContain('領 収 書');
    expect(m).toContain('上記正に領収いたしました');
    // レシート固有の要素は出さない（領収書がレシートのコピーになっていた不具合の再発防止）
    expect(m).not.toContain('照会番号');
    expect(m).not.toContain('ありがとうございました');
    expect(m.trimEnd().endsWith('[cut: feed; partial]')).toBe(true);
  });

  it('宛名・但し書きは未指定なら「上様」「お品代として」', () => {
    const m = ryoshushoToStarMarkup(base);
    expect(m).toContain('上様 様');
    expect(m).toContain('但 お品代として');
  });

  it('宛名・但し書きを指定すればそのまま印字する', () => {
    const m = ryoshushoToStarMarkup(base, { recipientName: ' 株式会社D&DREAM ', purpose: '御飲食代として' });
    expect(m).toContain('株式会社D&DREAM 様');
    expect(m).toContain('但 御飲食代として');
    expect(m).not.toContain('上様');
  });

  it('領収額は返金を差し引いた実受領額（netPaid）で、5万円未満は印紙欄を出さない', () => {
    const m = ryoshushoToStarMarkup({ ...base, refundTotal: 1300, netPaid: 10000 });
    expect(m).toContain('¥10,000');
    expect(m).not.toContain('収入印紙');
  });

  it('5万円以上は収入印紙欄を出す', () => {
    const m = ryoshushoToStarMarkup({ ...base, total: 50000, netPaid: 50000 });
    expect(m).toContain('収入印紙');
  });

  it('適格請求書の要件（税率別の対象額・消費税額・登録番号）を残す', () => {
    const m = ryoshushoToStarMarkup(base);
    expect(m).toContain('税10%対象');
    expect(m).toContain('登録番号 T1234567890123');
  });
});

const slip = {
  storeName: 'シュラスコテーブル FOGO',
  orderNo: '1001',
  tableName: 'T-3',
  guestCount: 4,
  clerkName: '山田',
  issuedAt: '2026/09/19 19:30',
  lines: [
    { name: 'シュラスコ食べ放題', quantity: 2, unitPrice: 5000, lineTotal: 10000, modifiers: [] },
    { name: '生ビール', quantity: 3, unitPrice: 600, lineTotal: 1800, modifiers: [{ name: '大', price: 100 }] },
  ],
  subtotal: 10727,
  taxTotal: 1073,
  serviceCharge: 0,
  discount: 500,
  total: 11300,
};

describe('orderSlipMarkup（注文伝票）', () => {
  it('注文内容と合計金額を出し、領収書ではないと明記する', () => {
    const m = orderSlipMarkup(slip, { paperWidth: 80 });
    expect(m).toContain('お会計伝票');
    expect(m).toContain('T-3');
    expect(m).toContain('4名');
    expect(m).toContain('担当 山田');
    expect(m).toContain('シュラスコ食べ放題');
    expect(m).toContain('生ビール');
    expect(m).toContain('大');
    expect(m).toContain('¥11,300');
    expect(m).toContain('※ これは領収書ではありません');
    expect(m.trimEnd().endsWith('[cut: feed; partial]')).toBe(true);
  });

  it('テーブルが無い（テイクアウト）場合も生成できる', () => {
    const m = orderSlipMarkup({ ...slip, tableName: null, guestCount: null, clerkName: null }, { paperWidth: 58 });
    expect(m).toContain('テイクアウト');
    expect(m).toContain('¥11,300');
  });
});

describe('お客様に渡す紙は日本語のまま（英語を混ぜない）', () => {
  // 厨房伝票だけを英語主体にする方針。レシート・領収書・注文伝票はお客様が受け取るため日本語。
  // 将来ここに englishName を配線してしまったら落ちるようにしておく。
  const jp = {
    ...base,
    lines: [{ name: 'チキンカレー', quantity: 1, unitPrice: 1000, lineTotal: 1000, modifiers: [], cancelled: false }],
  };

  it('レシートは日本語のみ', () => {
    const m = receiptToStarMarkup(jp);
    expect(m).toContain('チキンカレー');
    expect(m).not.toContain('Chikinkaree');
    expect(m).toContain('合計');
  });

  it('領収書は日本語のみ', () => {
    const m = ryoshushoToStarMarkup(jp);
    expect(m).toContain('領 収 書');
    expect(m).not.toContain('Chikinkaree');
    expect(m).not.toContain('RECEIPT');
  });

  it('注文伝票は日本語のみ', () => {
    const m = orderSlipMarkup({
      ...slip,
      lines: [{ name: 'チキンカレー', quantity: 1, unitPrice: 1000, lineTotal: 1000, modifiers: [] }],
    });
    expect(m).toContain('チキンカレー');
    expect(m).not.toContain('Chikinkaree');
    expect(m).toContain('お会計伝票');
  });
});
