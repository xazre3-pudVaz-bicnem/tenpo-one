/**
 * レジ精算レシート（dinii の「レジ精算」相当）の整形（純関数・テスト対象）。
 *
 * レジ締め時にレジプリンターから自動で出す1枚。現場の締め作業がこの紙だけで完結するよう、
 * その営業日の売上（店舗全体）と、そのレジの現金精算（釣銭準備金・実査・差額・金種別）を載せる。
 * 出力は LayoutLine[] にして、Star Markup / StarPRNT / ePOS-Print の各レンダラ
 * （kitchenTicketMarkup / kitchenTicketStarPrnt / kitchenTicketEpos）で印字する。
 *
 * 数字の定義（dinii と合わせる）:
 *   総売上 … 会計済み注文の支払総額（税込）。返金・取消は含めない（返金は別行）
 *   純売上 … 総売上から消費税を除いた額（税抜）
 *   （値引前）… 値引・クーポン適用前の額
 */
import { CASH_DENOMINATIONS, type CashDenomination, type DenominationCounts } from './cash-count';
import type { LayoutLine } from './kitchen-ticket';
import { colsFor, dispWidth, twoCol, wrapText, yen, type PaperWidth, type WidthOptions } from './receipt-layout';

export interface ReportCountAmount {
  label: string;
  count: number;
  amount: number;
}

export interface ReportChannel {
  label: string;
  sales: number;
  guests: number;
  groups: number;
}

export interface RegisterReportData {
  storeName: string;
  registerName: string;
  /** 表示用の営業日（例: 2026/09/20（日）） */
  businessDateLabel: string;
  /** 処理番号（レジセッションID） */
  sessionNo: string;
  openedAtLabel: string;
  openedBy: string;
  closedAtLabel: string;
  closedBy: string;
  printedAtLabel: string;
  sales: {
    gross: number;
    net: number;
    grossBeforeDiscount: number;
    netBeforeDiscount: number;
    discount: number;
    serviceCharge: number;
    refunds: number;
    ordersCount: number;
    guests: number;
    /** 組数（会計した伝票の数。日計レポートの「組数」） */
    groups: number;
    /** 客単価（総売上 ÷ 客数） */
    avgSpend: number;
    /** 総売上点数（売れた商品の個数の合計） */
    itemQuantity: number;
    /** 税率別（総売上ベース）。rate は % */
    taxByRate: { rate: number; taxable: number; tax: number }[];
  };
  /** 支払方法別（売上） */
  payments: ReportCountAmount[];
  /** 支払方法別（返金）。無ければ空 */
  refundsByMethod: ReportCountAmount[];
  discounts: { count: number; amount: number };
  surcharges: { count: number; amount: number };
  /** メニュータイプ別（フード／ドリンク／コース／オプション） */
  byItemType: { label: string; quantity: number; amount: number }[];
  /** 媒体別（予約経路）。先頭は［全体］ */
  byChannel: ReportChannel[];
  cash: {
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    cashIn: number;
    cashOut: number;
    expected: number;
    counted: number | null;
    difference: number | null;
    /** 締め時の金種別枚数。未保存なら null（旧データ） */
    denominations: DenominationCounts | null;
    /** お預かり現金（現金会計でお客様から受け取った額の合計） */
    tendered: number;
    /** おつり（お預かり現金 − 現金売上） */
    change: number;
  };
  /** 差異の理由（締めのときに入れた文。無ければ null） */
  differenceReason: string | null;
  cashIns: { purpose: string; amount: number }[];
  cashOuts: { purpose: string; amount: number }[];
  /** 業務履歴（レジ会計・領収書発行・取消・返金・注文減数・注文キャンセル） */
  activity: ReportCountAmount[];
  note: string | null;
}

export interface RegisterReportOptions extends WidthOptions {
  paperWidth?: PaperWidth;
  /** 1行の桁数を直接指定する（EPSON機は用紙幅どおりだと右端で折り返すため少なくする。lib/epos-print.ts の eposCols） */
  columns?: number;
}

/** 開局・締めで保存する金種別枚数（金種の文字列 → 枚数）。denominationsToJson が作る jsonb の形 */
export type DenominationJson = Record<string, number>;

/** レジ締めアクションの結果。締め自体は成功したが精算レシートだけ出せなかったときは printWarning に理由が入る */
export type CloseRegisterResult =
  /** signOutAfter: レジ端末はレジ締めのあとログアウトする（2026-09-24 店舗要望） */
  | { ok: true; printWarning?: string | null; signOutAfter?: boolean }
  | { ok: false; error: string };

/** 金種のレシート表記（dinii と同じ「1円硬貨」「千円紙幣」形式） */
export function denominationReportLabel(denom: CashDenomination): string {
  switch (denom) {
    case 1000:
      return '千円紙幣';
    case 5000:
      return '5千円紙幣';
    case 10000:
      return '1万円紙幣';
    default:
      return `${denom}円硬貨`;
  }
}

/** 左・中（件数など）・右（金額）の3段組。中と右は右寄せ。 */
export function threeCol(left: string, mid: string, right: string, width: number, options: WidthOptions = {}): string {
  const w = (s: string) => dispWidth(s, options);
  const rightW = Math.max(w(right), 10);
  const midW = Math.max(w(mid), 6);
  const leftW = width - rightW - midW - 2;
  if (w(left) > leftW) {
    // 左が長いときは左を1行にして、次行に中・右を右寄せで出す
    const tail = ' '.repeat(Math.max(0, midW - w(mid))) + mid + ' '.repeat(rightW + 1 - w(right)) + right;
    return `${left}\n${' '.repeat(Math.max(0, width - w(tail)))}${tail}`;
  }
  return (
    left +
    ' '.repeat(leftW - w(left)) +
    ' '.repeat(midW - w(mid)) +
    mid +
    ' '.repeat(rightW + 2 - w(right)) +
    right
  );
}

const signedYen = (n: number): string => (n < 0 ? `-${yen(-n)}` : yen(n));

/**
 * レジ精算レシートの本文を組み立てる。
 * 見た目は dinii の「レジ精算」に合わせる（御茶ノ水の dinii 精算レシート写真を基準）:
 *   見出しは倍角・中央、店名は中央、区画は「空行 → ＿線 → 空行 → 【見出し】 → 空行」、
 *   区画内の小見出し（<売上> 等）の間は「空行 → - - - 線 → 空行」、行グループの間に空行、
 *   金額は右端揃え、件数は金額の左の列。税率別は 10% / 8% / 非課税 を常に出す。
 */
export function layoutRegisterReport(data: RegisterReportData, options: RegisterReportOptions = {}): LayoutLine[] {
  const width = options.columns ?? colsFor(options.paperWidth);
  const widthOpts: WidthOptions = { yenFullWidth: options.yenFullWidth, cjkExtra: options.cjkExtra };
  const solid = '_'.repeat(width);
  const dotted = '- '.repeat(Math.floor(width / 2)).trimEnd();
  const L: LayoutLine[] = [];
  // 長い文章（備考・店名など）は桁数で折り返す（プリンタ任せだと1文字だけ次行に落ちる）
  const line = (text: string, size: LayoutLine['size'] = 'normal', align: LayoutLine['align'] = 'left') => {
    for (const w of wrapText(text, width, widthOpts)) L.push({ text: w, align, size });
  };
  const center = (text: string, size: LayoutLine['size'] = 'normal') => line(text, size, 'center');
  const kv = (label: string, value: string) => line(twoCol(label, value, width, widthOpts));
  const kcv = (label: string, count: string, value: string) => line(threeCol(label, count, value, width, widthOpts));
  const blank = () => line('');
  /** 区画の見出し。最初の区画は線なしで空行2つ、以降は「空行・＿線・空行」で区切る */
  const section = (title: string, first = false) => {
    blank();
    if (!first) {
      line(solid);
      blank();
    } else {
      blank();
    }
    line(`【${title}】`);
    blank();
  };
  const sub = (title: string) => line(`<${title}>`);
  /** 区画内の小見出しの区切り（空行・- - - 線・空行） */
  const subSep = () => {
    blank();
    line(dotted);
    blank();
  };

  center('レジ精算', 'large');
  center(data.storeName);
  blank();
  line(`営業日: ${data.businessDateLabel}`);
  line(`処理番号: ${data.sessionNo}`);
  line(`レジ: ${data.registerName}`);
  line(`開局: ${data.openedAtLabel}  ${data.openedBy}`);
  line(`締め: ${data.closedAtLabel}  ${data.closedBy}`);

  // ---- 売上情報 ----
  section('売上情報', true);
  sub('売上');
  blank();
  kv('総売上', yen(data.sales.gross));
  kv('純売上', yen(data.sales.net));
  blank();
  kv('総売上 ( 値引前 )', yen(data.sales.grossBeforeDiscount));
  kv('純売上 ( 値引前 )', yen(data.sales.netBeforeDiscount));
  if (data.sales.refunds > 0) kv('返金', `-${yen(data.sales.refunds)}`);
  blank();
  kcv('会計件数', `${data.sales.ordersCount}件`, `${data.sales.guests}名`);
  blank();
  kv('組数', `${data.sales.groups}組`);
  kv('客数', `${data.sales.guests}客`);
  kv('客単価', yen(data.sales.avgSpend));
  kv('総売上点数', `${data.sales.itemQuantity}点`);
  subSep();
  sub('税率別 ( 総売上 )');
  const taxRow = (rate: number) => data.sales.taxByRate.find((t) => t.rate === rate);
  for (const rate of [10, 8]) {
    const t = taxRow(rate);
    kv(`${rate}%対象額`, yen(t?.taxable ?? 0));
    kv('うち消費税', yen(t?.tax ?? 0));
  }
  kv('非課税額', yen(taxRow(0)?.taxable ?? 0));

  // ---- 支払情報 ----
  section('支払情報');
  if (data.payments.length === 0) line('会計はありません');
  for (const p of data.payments) kcv(p.label, `${p.count}件`, yen(p.amount));
  if (data.cash.tendered > 0) {
    blank();
    kv('お預かり現金', yen(data.cash.tendered));
    kv('おつり', yen(data.cash.change));
  }
  if (data.refundsByMethod.length > 0) {
    subSep();
    sub('返金');
    for (const p of data.refundsByMethod) kcv(p.label, `${p.count}件`, `-${yen(p.amount)}`);
  }

  // ---- 割引・割増 ----
  section('割引・割増情報');
  sub('割引情報');
  kcv('合計', `${data.discounts.count}件`, data.discounts.amount > 0 ? `-${yen(data.discounts.amount)}` : yen(0));
  subSep();
  sub('割増情報 ( サービス料 )');
  kcv('合計', `${data.surcharges.count}件`, yen(data.surcharges.amount));

  // ---- 売上詳細 ----
  section('売上詳細情報 ( 税込 )');
  sub('メニュータイプ別');
  for (const t of data.byItemType) kcv(t.label, `${t.quantity}個`, yen(t.amount));
  subSep();
  sub('媒体別');
  for (const c of data.byChannel) {
    blank();
    line(`[${c.label}]`);
    kv('売上', yen(c.sales));
    kv('人数', `${c.guests}人`);
    kv('組数', `${c.groups}組`);
    kv('客単価', c.guests > 0 ? yen(Math.round(c.sales / c.guests)) : yen(0));
  }

  // ---- 精算情報 ----
  section('精算情報');
  kv('釣銭準備金', yen(data.cash.openingFloat));
  kv('現金受領', yen(data.cash.cashSales));
  if (data.cash.cashRefunds > 0) kv('現金返金', `-${yen(data.cash.cashRefunds)}`);
  kv('入出金計', signedYen(data.cash.cashIn - data.cash.cashOut));
  blank();
  kv('想定金額', yen(data.cash.expected));
  kv('在高実績', data.cash.counted == null ? '未入力' : yen(data.cash.counted));
  kv('差額', data.cash.difference == null ? '未入力' : signedYen(data.cash.difference));
  kv('差異理由', data.differenceReason?.trim() || '未選択');
  if (data.cash.denominations) {
    subSep();
    sub('金種');
    for (const d of CASH_DENOMINATIONS) {
      const n = data.cash.denominations[d] ?? 0;
      kcv(denominationReportLabel(d), `${n}枚`, yen(d * n));
    }
  }

  // ---- 入出金情報 ----
  section('入出金情報');
  sub('入金情報');
  if (data.cashIns.length === 0) line('  なし');
  for (const t of data.cashIns) kv(`  ${t.purpose}`, yen(t.amount));
  subSep();
  sub('出金情報');
  if (data.cashOuts.length === 0) line('  なし');
  for (const t of data.cashOuts) kv(`  ${t.purpose}`, `-${yen(t.amount)}`);

  // ---- 業務履歴 ----
  section('業務履歴');
  for (const a of data.activity) kcv(a.label, `${a.count}件`, a.amount < 0 ? `-${yen(-a.amount)}` : yen(a.amount));

  blank();
  line(solid);
  blank();
  line(`備考: ${data.note ?? ''}`);
  blank();
  line(`印刷日時: ${data.printedAtLabel}`);
  line(`担当者: ${data.closedBy}`);
  blank();
  return L;
}

/**
 * 税率別内訳。行の税込額を税率ごとに集計し、合計が総売上（値引・サービス料・端数調整後）と
 * 一致するよう按分してから、内税として消費税を逆算する。
 * 注文単位の tax_total とは端数で数円ずれることがあるが、レジ精算の「対象額の目安」としては十分。
 */
export function taxByRateFor(items: { lineTotal: number; taxRate: number }[], gross: number) {
  const byRate = new Map<number, number>();
  let itemsSum = 0;
  for (const it of items) {
    byRate.set(it.taxRate, (byRate.get(it.taxRate) ?? 0) + it.lineTotal);
    itemsSum += it.lineTotal;
  }
  const rates = [...byRate.entries()].sort((a, b) => b[0] - a[0]);
  const scale = itemsSum > 0 ? gross / itemsSum : 0;
  let allocated = 0;
  return rates.map(([rate, amount], i) => {
    const last = i === rates.length - 1;
    const taxable = last ? gross - allocated : Math.round(amount * scale);
    allocated += taxable;
    const tax = rate > 0 ? taxable - Math.floor((taxable * 100) / (100 + rate)) : 0;
    return { rate, taxable, tax };
  });
}

/** 金種別枚数 jsonb（{"1000": 20, ...}）を DenominationCounts に正規化する。不正値は捨てる */
export function parseDenominations(raw: unknown): DenominationCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: DenominationCounts = {};
  let any = false;
  for (const d of CASH_DENOMINATIONS) {
    const v = (raw as Record<string, unknown>)[String(d)];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) {
      out[d] = Math.floor(n);
      any = true;
    }
  }
  return any ? out : null;
}

/** DenominationCounts を jsonb 保存用（金種文字列→枚数）にする。未入力の金種は 0 */
export function denominationsToJson(counts: DenominationCounts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of CASH_DENOMINATIONS) out[String(d)] = Math.max(0, Math.floor(counts[d] ?? 0));
  return out;
}
