import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  denominationReportLabel,
  denominationsToJson,
  layoutRegisterReport,
  parseDenominations,
  taxByRateFor,
  threeCol,
  type RegisterReportData,
} from '@/lib/register-report';
import { dispWidth } from '@/lib/receipt-layout';
import { kitchenTicketMarkup } from '@/lib/receipt-markup';
import { kitchenTicketStarPrnt } from '@/lib/starprnt';
import { kitchenTicketEpos, eposCols } from '@/lib/epos-print';

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

describe('layoutRegisterReport', () => {
  it('dinii のレジ精算と同じ区画がすべて入り、全行が用紙幅に収まる', () => {
    const lines = layoutRegisterReport(sample(), { paperWidth: 80 });
    const text = lines.map((l) => l.text).join('\n');
    for (const section of [
      '【売上情報】',
      '【支払情報】',
      '【割引・割増情報】',
      '【売上詳細情報 ( 税込 )】',
      '【精算情報】',
      '【入出金情報】',
      '【業務履歴】',
    ]) {
      expect(text).toContain(section);
    }
    expect(lines[0]).toEqual({ text: 'レジ精算', align: 'center', size: 'large' });
    expect(text).toContain('営業日: 2026/09/20（日）');
    expect(text).toContain('総売上');
    expect(text).toContain('¥141,800');
    expect(text).toContain('10%対象額');
    expect(text).toContain('うち消費税');
    expect(text).toContain('¥12,891');
    expect(text).toContain('釣銭準備金');
    expect(text).toContain('在高実績');
    expect(text).toContain('千円紙幣');
    expect(text).toMatch(/千円紙幣\s+40枚\s+¥40,000/);
    expect(text).toContain('[HOT PEPPER]');
    expect(text).toContain('食材 買い出し');
    expect(text).toContain('レジ会計');
    expect(text).toContain('印刷日時: 2026/9/20 23:12');
    for (const l of text.split('\n')) {
      expect(dispWidth(l)).toBeLessThanOrEqual(48);
    }
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

  it('日計レポートの項目（組数・客数・客単価・総売上点数・お預かり現金・おつり・差異理由）が出る', () => {
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
    expect(text).toContain('差異理由');
    expect(text).toContain('未選択');
  });

  it('差額があれば符号付き、実査が無ければ「未入力」、金種が無ければ金種表は出ない', () => {
    const lines = layoutRegisterReport(
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
    expect(text).toContain('備考: 差額理由: 釣銭の渡し間違い');

    const open = layoutRegisterReport(sample({ cash: { ...sample().cash, counted: null, difference: null } }));
    const openText = open.map((l) => l.text).join('\n');
    expect(openText).toMatch(/在高実績\s+未入力/);
  });

  it('長い備考は桁数で折り返され、1行が用紙幅を超えない', () => {
    const note = 'あ'.repeat(40) + 'い'.repeat(40);
    const lines = layoutRegisterReport(sample({ note }), { paperWidth: 80 });
    const noteLines = lines.filter((l) => l.text.includes('あ') || l.text.includes('い'));
    expect(noteLines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(dispWidth(l.text)).toBeLessThanOrEqual(48);
  });

  it('返金があれば売上と支払の両方に返金行が出る', () => {
    const lines = layoutRegisterReport(
      sample({
        sales: { ...sample().sales, refunds: 3300 },
        refundsByMethod: [{ label: '現金', count: 1, amount: 3300 }],
      })
    );
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/返金\s+-¥3,300/);
    expect(text).toContain('<返金>');
  });

  it('3種のレンダラで印字データにできる（Markup / StarPRNT cp932 / ePOS XML）', () => {
    const lines = layoutRegisterReport(sample());
    const markup = kitchenTicketMarkup(lines);
    expect(markup).toContain('[magnify: width 2; height 2]');
    expect(markup).toContain('レジ精算');
    expect(markup).toContain('\\[全体\\]'); // Star Markup では [ ] をエスケープ
    expect(markup).toContain('[cut: feed; partial]');

    const buf = kitchenTicketStarPrnt(lines);
    const decoded = iconv.decode(buf, 'Shift_JIS');
    expect(decoded).toContain('【精算情報】');
    expect(decoded).toContain('千円紙幣');

    const epos = kitchenTicketEpos(lines);
    expect(epos).toContain('<epos-print');
    expect(epos).toContain('レジ精算');
    expect(epos).toContain('<cut');
  });
});
