import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  denominationReportLabel,
  denominationsToJson,
  layoutRegisterReport,
  layoutSettlementReport,
  parseDenominations,
  taxByRateFor,
  threeCol,
  type RegisterReportData,
} from '@/lib/register-report';
import { dispWidth } from '@/lib/receipt-layout';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';
import { kitchenTicketEpos, eposCols, EPOS_TIGHT_LINE_SPACING } from '@/lib/epos-print';

const sample = (over: Partial<RegisterReportData> = {}): RegisterReportData => ({
  storeName: 'FULL MOoN 御茶ノ水店',
  registerName: 'レジ（レシート）',
  businessDateLabel: '2026/09/20（日）',
  sessionNo: '4711A2B3',
  openedAtLabel: '2026/9/20 10:58',
  openedBy: 'Ronnie',
  closedAtLabel: '2026/9/20 23:12',
  closedBy: 'Ronnie',
  printedAtLabel: '2026/9/20 23:12',
  sales: {
    gross: 141800,
    net: 128909,
    grossBeforeDiscount: 143800,
    netBeforeDiscount: 130727,
    discount: 2000,
    serviceCharge: 0,
    refunds: 0,
    ordersCount: 61,
    guests: 132,
    groups: 61,
    avgSpend: 1074,
    itemQuantity: 230,
    taxByRate: [
      { rate: 10, taxable: 141800, tax: 12891 },
      { rate: 8, taxable: 0, tax: 0 },
    ],
  },
  payments: [
    { label: '現金', count: 25, amount: 72900 },
    { label: 'クレジット', count: 30, amount: 60700 },
    { label: 'QRコード決済（PayPay等）', count: 6, amount: 8200 },
  ],
  refundsByMethod: [],
  discounts: { count: 1, amount: 2000 },
  surcharges: { count: 0, amount: 0 },
  byItemType: [
    { label: 'フード', quantity: 190, amount: 120000 },
    { label: 'ドリンク', quantity: 40, amount: 21800 },
    { label: 'コース', quantity: 0, amount: 0 },
    { label: 'オプション', quantity: 0, amount: 0 },
  ],
  byChannel: [
    { label: '全体', sales: 141800, guests: 132, groups: 61 },
    { label: 'フリー', sales: 121800, guests: 112, groups: 55 },
    { label: 'HOT PEPPER', sales: 20000, guests: 20, groups: 6 },
  ],
  cash: {
    openingFloat: 50000,
    cashSales: 72900,
    cashRefunds: 0,
    cashIn: 0,
    cashOut: 3000,
    expected: 119900,
    counted: 119900,
    difference: 0,
    denominations: { 1: 10, 10: 20, 100: 30, 500: 8, 1000: 40, 5000: 4, 10000: 5 },
    tendered: 80000,
    change: 7100,
  },
  cashIns: [],
  cashOuts: [{ purpose: '食材 買い出し', amount: 3000 }],
  activity: [
    { label: 'レジ会計', count: 61, amount: 141800 },
    { label: '領収書発行', count: 3, amount: 12000 },
    { label: '取消（VOID）', count: 0, amount: 0 },
    { label: '返金', count: 0, amount: 0 },
    { label: 'メニュー注文減数', count: 2, amount: -1800 },
    { label: '注文キャンセル', count: 0, amount: 0 },
  ],
  note: null,
  differenceReason: null,
  ...over,
});

describe('threeCol', () => {
  it('80mm（48桁）で1行に収まり、中・右が右寄せになる', () => {
    const s = threeCol('現金', '25件', '¥72,900', 48);
    expect(s).not.toContain('\n');
    expect(dispWidth(s)).toBe(48);
    expect(s.endsWith('¥72,900')).toBe(true);
    expect(s).toMatch(/現金\s+25件\s+¥72,900$/);
  });

  it('左が長いときは2行に分け、2行目を右寄せにする', () => {
    const s = threeCol('QRコード決済（PayPay等）あいうえおかきくけこ', '6件', '¥8,200', 32);
    const [first, second] = s.split('\n');
    expect(first).toBe('QRコード決済（PayPay等）あいうえおかきくけこ');
    expect(dispWidth(second)).toBe(32);
    expect(second.trimStart()).toMatch(/^6件\s+¥8,200$/);
  });
});

describe('taxByRateFor', () => {
  it('税率ごとに税込額を集計し、内税で消費税を逆算する', () => {
    const rows = taxByRateFor(
      [
        { lineTotal: 1100, taxRate: 10 },
        { lineTotal: 2200, taxRate: 10 },
        { lineTotal: 1080, taxRate: 8 },
      ],
      4380
    );
    expect(rows).toEqual([
      { rate: 10, taxable: 3300, tax: 300 },
      { rate: 8, taxable: 1080, tax: 80 },
    ]);
  });

  it('値引で総売上が明細合計より小さいときは按分し、合計が総売上と一致する', () => {
    const rows = taxByRateFor(
      [
        { lineTotal: 3000, taxRate: 10 },
        { lineTotal: 1000, taxRate: 8 },
      ],
      3600 // 400円引き
    );
    expect(rows.reduce((a, r) => a + r.taxable, 0)).toBe(3600);
    expect(rows[0]).toEqual({ rate: 10, taxable: 2700, tax: 246 });
    expect(rows[1].taxable).toBe(900);
  });

  it('明細が無ければ空', () => {
    expect(taxByRateFor([], 0)).toEqual([]);
  });
});

describe('金種別枚数の保存形式', () => {
  it('toJson は全金種のキーを持ち、未入力は 0', () => {
    expect(denominationsToJson({ 1000: 20, 500: 3 })).toEqual({
      '1': 0,
      '5': 0,
      '10': 0,
      '50': 0,
      '100': 0,
      '500': 3,
      '1000': 20,
      '5000': 0,
      '10000': 0,
    });
  });

  it('parse は jsonb（文字列キー）を DenominationCounts に戻し、不正値は捨てる', () => {
    expect(parseDenominations({ '1000': 20, '500': '3', '100': -1, '10': 'x', '7': 5 })).toEqual({ 1000: 20, 500: 3 });
    expect(parseDenominations(null)).toBeNull();
    expect(parseDenominations('abc')).toBeNull();
    expect(parseDenominations({})).toBeNull();
  });

  it('toJson → parse で往復できる', () => {
    const counts = { 1: 4, 100: 12, 10000: 3 };
    expect(parseDenominations(denominationsToJson(counts))).toEqual({
      1: 4,
      5: 0,
      10: 0,
      50: 0,
      100: 12,
      500: 0,
      1000: 0,
      5000: 0,
      10000: 3,
    });
  });

  it('レシート表記は dinii と同じ「1円硬貨」「千円紙幣」形式', () => {
    expect(denominationReportLabel(1)).toBe('1円硬貨');
    expect(denominationReportLabel(500)).toBe('500円硬貨');
    expect(denominationReportLabel(1000)).toBe('千円紙幣');
    expect(denominationReportLabel(5000)).toBe('5千円紙幣');
    expect(denominationReportLabel(10000)).toBe('1万円紙幣');
  });
});

describe('layoutRegisterReport（2026-09-28 Ronnie が選んだ並び）', () => {
  it('上から：締め → 客数・売上 → 値引 → ＊支払情報＊ → ＊媒体別＊ → ＊入出金情報＊（明細・現金在高・差異合計） → ＊業務履歴＊', () => {
    const lines = layoutRegisterReport(sample(), { paperWidth: 80 });
    const text = lines.map((l) => l.text).join('\n');
    const order = [
      '締め: 2026/9/20 23:12  Ronnie',
      '組数',
      '客数',
      '客単価',
      '総売上点数',
      '税率  10% (内消費税 ¥12,891)',
      '消費税',
      '純売上',
      '値割引',
      '＊支払情報＊',
      '現金',
      'クレジット',
      'お預かり現金',
      'おつり',
      '領収書',
      '＊媒体別（税込）＊',
      'フリー',
      'HOT PEPPER',
      '＊入出金情報＊',
      'レジオープン時現金',
      '出金',
      '食材 買い出し',
      '現金在高',
      '差異合計',
      '＊業務履歴＊',
      'レジ会計',
      '印刷日時: 2026/9/20 23:12',
      '担当者: Ronnie',
    ];
    let at = -1;
    for (const key of order) {
      const idx = text.indexOf(key, at + 1);
      expect(idx, key).toBeGreaterThan(at);
      at = idx;
    }
    expect(lines[0]).toEqual({ text: 'レジ精算', align: 'center', size: 'large' });
    expect(text).toContain('営業日: 2026/09/20（日）');
    expect(text).toMatch(/売上\s+¥141,800/);
    expect(text).toMatch(/純売上\s+¥128,909/);
    expect(text).toMatch(/組数\s+61組/);
    expect(text).toMatch(/客数\s+132客/);
    expect(text).toMatch(/現金\s+25件\s+¥72,900/);
    expect(text).toMatch(/食材 買い出し\s+-¥3,000/);
    expect(text).toMatch(/HOT PEPPER\s+¥20,000/);
    expect(text).toMatch(/  6組 20人 客単価\s+¥1,000/);
    for (const l of text.split('\n')) {
      expect(dispWidth(l)).toBeLessThanOrEqual(48);
    }
  });

  it('30cm に：0件・¥0 の行、[全体]、空の見出し、男女の無い日の内訳は出さない（2026-09-28 Ronnie）', () => {
    const lines = layoutRegisterReport(sample(), { paperWidth: 80 });
    const text = lines.map((l) => l.text).join('\n');
    for (const hidden of [
      'サービス料', '深夜料', '端数値引', '控除', '取消（赤伝票）', '訂正（黒伝票）', '未回収', '差異理由', '未選択',
      '銀行振込', '貸金庫預け', '警備会社預け', '[全体]', '【', '<入金情報>', '入金 ', '男性', '選択なし',
      '取消（VOID）', '返金', '注文キャンセル',
    ]) {
      expect(text, hidden).not.toContain(hidden);
    }
    // 0 でも出す行：現金・現金在高・差異合計・レジオープン時現金・レジ会計
    const empty = layoutRegisterReport(
      sample({
        payments: [{ label: '現金', count: 0, amount: 0 }, { label: 'クレジット', count: 0, amount: 0 }],
        activity: [{ label: 'レジ会計', count: 0, amount: 0 }],
        cashOuts: [],
        cash: { ...sample().cash, cashOut: 0, tendered: 0, change: 0 },
      })
    )
      .map((l) => l.text)
      .join('\n');
    expect(empty).toMatch(/現金\s+0件\s+¥0/);
    expect(empty).not.toContain('クレジット');
    expect(empty).toMatch(/レジ会計\s+0件\s+¥0/);
    expect(empty).toContain('現金在高');
    expect(empty).toContain('差異合計');
    expect(empty).toContain('レジオープン時現金');
    expect(empty).not.toContain('お預かり現金');
    expect(empty).not.toMatch(/^出金/m);
    // 普通の日（SEABIRD 9/28 くらい）で 60行以内（行間 3mm で 20cm 前後）
    expect(lines.length).toBeLessThanOrEqual(60);
  });

  it('男性・女性が入っている日は 客数 の行に内訳（0 の区分は出さない）', () => {
    const text = layoutRegisterReport(sample({ sales: { ...sample().sales, guestsMale: 50, guestsFemale: 82 } }))
      .map((l) => l.text)
      .join('\n');
    expect(text).toMatch(/客数（男性50・女性82）\s+132客/);
    const withUnselected = layoutRegisterReport(sample({ sales: { ...sample().sales, guestsMale: 50, guestsFemale: 80 } }))
      .map((l) => l.text)
      .join('\n');
    expect(withUnselected).toMatch(/客数（男性50・女性80・選択なし2）\s+132客/);
  });

  it('レジ実績入力は 支払情報・現金在高 にまとめる（2026-09-28 Ronnie「同じもの。まとめて」）', () => {
    const lines = layoutRegisterReport(sample(), { paperWidth: 80 });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).not.toContain('レジ実績入力');
    expect(text).not.toContain('実績');
    // 現金は1回だけ（支払情報）。在高は 現金在高 の行
    expect(text.match(/^現金\s/gm)?.length).toBe(1);
    expect(text.match(/^クレジット/gm)?.length).toBe(1);
    expect(text).toMatch(/現金在高\s+¥119,900\n差異合計\s+¥0/);
    // 現金以外で記録と違う額が入ったときだけ「実績」
    const diff = layoutRegisterReport(
      sample({
        countedByMethod: [
          { label: '現金', amount: 119900 },
          { label: 'クレジット', amount: 60000 },
          { label: 'QRコード決済（PayPay等）', amount: 8200 },
        ],
      })
    )
      .map((l) => l.text)
      .join('\n');
    expect(diff).toMatch(/クレジット\s+30件\s+¥60,700\n  実績\s+¥60,000/);
    expect(diff.match(/実績/g)?.length).toBe(1);
  });

  it('差額がある日・理由がある日は 差異理由 を出す', () => {
    const text = layoutRegisterReport(sample({ cash: { ...sample().cash, counted: 119400, difference: -500 } }))
      .map((l) => l.text)
      .join('\n');
    expect(text).toMatch(/差異合計\s+-¥500/);
    expect(text).toMatch(/差異理由\s+未選択/);
  });

  it('本紙には精算情報（釣銭準備金・金種・在高実績）を出さない。8% は売上があった日だけ', () => {
    const text = layoutRegisterReport(sample()).map((l) => l.text).join('\n');
    expect(text).not.toContain('【精算情報】');
    expect(text).not.toContain('釣銭準備金');
    expect(text).not.toContain('千円紙幣');
    expect(text).not.toContain('在高実績');
    expect(text).not.toContain('税率  8%');
    const withEight = layoutRegisterReport(
      sample({ sales: { ...sample().sales, taxByRate: [{ rate: 10, taxable: 100000, tax: 9091 }, { rate: 8, taxable: 41800, tax: 3096 }] } })
    )
      .map((l) => l.text)
      .join('\n');
    expect(withEight).toMatch(/税率  8% \(内消費税 ¥3,096\)\s+¥41,800/);
  });

  it('控除（返金・取消）と 訂正・未回収・領収書 が出る', () => {
    const text = layoutRegisterReport(
      sample({
        deductions: { count: 2, amount: 3300, tax: 300, items: ['返金', '取消'] },
        corrections: { label: '訂正（黒伝票）', count: 1, amount: 2840 },
        uncollected: { label: '未回収', count: 1, amount: 5000 },
        receipts: { count: 3 },
      })
    )
      .map((l) => l.text)
      .join('\n');
    expect(text).toMatch(/控除\s+2点\s+¥3,300/);
    expect(text).toContain('控除項目 返金・取消');
    expect(text).toMatch(/控除項目税額\s+¥300/);
    expect(text).toMatch(/控除後純売上\s+¥125,909/);
    expect(text).toMatch(/訂正（黒伝票）\s+1件\s+¥2,840/);
    expect(text).toMatch(/未回収\s+1件\s+¥5,000/);
    expect(text).toMatch(/領収書\s+3件/);
  });

  it('58mm でも全行が32桁に収まる', () => {
    const lines = layoutRegisterReport(sample(), { paperWidth: 58 });
    for (const l of lines.flatMap((x) => x.text.split('\n'))) {
      expect(dispWidth(l)).toBeLessThanOrEqual(32);
    }
  });

  it('EPSON機向け（eposCols の桁数・¥を全角幅で数える）でも全行が桁数に収まり、金額の右端が揃う', () => {
    const cols = eposCols(80);
    expect(cols).toBeLessThan(48);
    const lines = layoutRegisterReport(sample(), { columns: cols, yenFullWidth: true });
    const opts = { yenFullWidth: true };
    for (const l of lines.flatMap((x) => x.text.split('\n'))) {
      expect(dispWidth(l, opts)).toBeLessThanOrEqual(cols);
    }
    // 2段組・3段組の金額行は右端（46桁目）で揃う
    const amountLines = lines.map((x) => x.text).filter((t) => /¥[\d,]+$/.test(t) && !t.includes('\n'));
    expect(amountLines.length).toBeGreaterThan(5);
    for (const t of amountLines) expect(dispWidth(t, opts)).toBe(cols);
  });

  it('日計レポートの項目（組数・客数・客単価・総売上点数・お預かり現金・おつり）が出る', () => {
    const text = layoutRegisterReport(sample())
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('組数');
    expect(text).toContain('61組');
    expect(text).toContain('客単価');
    expect(text).toContain('総売上点数');
    expect(text).toContain('230点');
    expect(text).toContain('お預かり現金');
    expect(text).toContain('おつり');
  });

  it('精算情報の紙：釣銭準備金〜金種。差額があれば符号付き、実査が無ければ「未入力」、金種が無ければ金種表は出ない', () => {
    const full = layoutSettlementReport(sample(), { paperWidth: 80 });
    const fullText = full.map((l) => l.text).join('\n');
    expect(full[0]).toEqual({ text: 'レジ精算 精算情報', align: 'center', size: 'large' });
    expect(fullText).toContain('【精算情報】');
    expect(fullText).toMatch(/釣銭準備金\s+¥50,000/);
    expect(fullText).toMatch(/在高実績\s+¥119,900/);
    expect(fullText).toMatch(/回収金額\s+¥69,900/);
    expect(fullText).toMatch(/翌準備金\s+¥50,000/);
    expect(fullText).toMatch(/千円紙幣\s+40枚\s+¥40,000/);
    for (const l of fullText.split('\n')) expect(dispWidth(l)).toBeLessThanOrEqual(48);

    const lines = layoutSettlementReport(
      sample({
        cash: {
          openingFloat: 50000,
          cashSales: 1000,
          cashRefunds: 0,
          cashIn: 0,
          cashOut: 0,
          expected: 51000,
          counted: 50500,
          tendered: 0,
          change: 0,
          difference: -500,
          denominations: null,
        },
        note: '差額理由: 釣銭の渡し間違い',
      })
    );
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/差額\s+-¥500/);
    expect(text).not.toContain('千円紙幣');

    const open = layoutSettlementReport(sample({ cash: { ...sample().cash, counted: null, difference: null } }));
    const openText = open.map((l) => l.text).join('\n');
    expect(openText).toMatch(/在高実績\s+未入力/);
    const mainOpen = layoutRegisterReport(sample({ cash: { ...sample().cash, counted: null, difference: null } }))
      .map((l) => l.text)
      .join('\n');
    expect(mainOpen).toMatch(/差異合計\s+未入力/);
  });

  it('精算情報：開局の比較（前回の翌準備金・過不足・理由）と、締めの 翌準備金・預入金・準備金不足（2026-09-28 Ronnie）', () => {
    const lines = layoutSettlementReport(
      sample({
        cash: {
          ...sample().cash,
          openingFloat: 100000,
          counted: 60000,
          openingExpected: 101000,
          openingDifference: -1000,
          openingDifferenceReason: '両替に使った',
          nextFloat: 60000,
          depositAmount: 0,
          floatShortage: 40000,
        },
      }),
      { paperWidth: 80 }
    );
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/前回の翌準備金\s+¥101,000/);
    expect(text).toMatch(/開局時過不足\s+-¥1,000/);
    expect(text).toContain('両替に使った');
    expect(text).toMatch(/翌準備金\s+¥60,000/);
    expect(text).toMatch(/準備金不足\s+-¥40,000/);
    expect(text).toMatch(/預入金\s+¥0/);
    expect(text).toMatch(/回収金額\s+¥0/);

    const ok = layoutSettlementReport(
      sample({ cash: { ...sample().cash, openingFloat: 100000, counted: 160000, nextFloat: 100000, depositAmount: 60000, floatShortage: 0 } })
    )
      .map((l) => l.text)
      .join('\n');
    expect(ok).toMatch(/預入金\s+¥60,000/);
    expect(ok).not.toContain('準備金不足');
    expect(ok).not.toContain('前回の翌準備金');
  });

  it('長い備考は桁数で折り返され、1行が用紙幅を超えない', () => {
    const note = 'あ'.repeat(40) + 'い'.repeat(40);
    const lines = layoutRegisterReport(sample({ note }), { paperWidth: 80 });
    const noteLines = lines.filter((l) => l.text.includes('あ') || l.text.includes('い'));
    expect(noteLines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(dispWidth(l.text)).toBeLessThanOrEqual(48);
  });

  it('備考があれば印刷日時の前に出る', () => {
    const text = layoutRegisterReport(sample({ note: '他のレジが開局中のため、売上情報は締め時点までの店舗全体の集計です' }))
      .map((l) => l.text)
      .join('\n');
    expect(text).toContain('備考: 他のレジが開局中');
    expect(text.indexOf('備考:')).toBeLessThan(text.indexOf('印刷日時:'));
  });

  it('3種のレンダラで印字データにできる（Markup / StarPRNT cp932 / ePOS XML）', () => {
    const lines = layoutRegisterReport(sample());
    const markup = kitchenTicketMarkup(lines);
    expect(markup).toContain('[magnify: width 2; height 2]');
    expect(markup).toContain('レジ精算');
    expect(markup).toContain('＊支払情報＊');
    expect(markup).toContain('[cut: feed; partial]');

    const buf = kitchenTicketStarPrnt(lines);
    const decoded = iconv.decode(buf, 'Shift_JIS');
    expect(decoded).toContain('＊業務履歴＊');
    expect(decoded).toContain('レジオープン時現金');

    const epos = kitchenTicketEpos(lines);
    expect(epos).toContain('<epos-print');
    expect(epos).toContain('レジ精算');
    expect(epos).toContain('<cut');
  });

  it('レジ精算の紙は行間 3mm（Star：ESC 0／EPSON：linespc 24）。厨房伝票などは今までどおり（2026-09-28 Ronnie「30cm に」）', () => {
    const lines = layoutRegisterReport(sample());
    const tight = kitchenTicketStarPrnt(lines, { tightLines: true });
    const normal = kitchenTicketStarPrnt(lines);
    // init（ESC @）・太字（ESC E）のすぐ後に ESC 0
    expect([...tight.subarray(0, 6)]).toEqual([0x1b, 0x40, 0x1b, 0x45, 0x1b, 0x30]);
    expect([...normal.subarray(0, 6)]).not.toEqual([0x1b, 0x40, 0x1b, 0x45, 0x1b, 0x30]);
    expect(kitchenTicketEpos(lines, { lineSpacing: EPOS_TIGHT_LINE_SPACING })).toContain('<feed linespc="24"/>');
    expect(kitchenTicketEpos(lines)).not.toContain('linespc');
    const loader = readFileSync(join(__dirname, '..', 'lib', 'register-report-loader.ts'), 'utf8');
    expect(loader).toContain('kitchenTicketStarPrnt(lines, { tightLines: true })');
    expect(loader).toContain('kitchenTicketEpos(eposLines, { lineSpacing: EPOS_TIGHT_LINE_SPACING })');
  });
});
