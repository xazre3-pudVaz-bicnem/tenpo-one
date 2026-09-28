/**
 * レジ精算レシート（dinii の「レジ精算」相当）の整形（純関数・テスト対象）。
 *
 * レジ締め時にレジプリンターから自動で出す1枚（本紙）。その営業日の売上（店舗全体）・支払・入出金・業務履歴。
 * 現金精算（釣銭準備金・実査・差額・金種別）は別の紙（layoutSettlementReport）で、レジクローズの「精算情報を印刷」のときだけ出す。
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
    /** 消費税の合計（総売上に含まれる内税）。無ければ taxByRate から足す */
    tax?: number;
    /** 客数の内訳（男性・女性）。入力が無い店は 0（残りは「選択なし」） */
    guestsMale?: number;
    guestsFemale?: number;
    /** 深夜料（件数・金額）。今は集計が無く 0 */
    lateNight?: { count: number; amount: number };
    /** 端数値引（orders.rounding_adjustment） */
    rounding?: { count: number; amount: number };
  };
  /** ランチ売上／ディナー売上（区切りの時刻までに始まった伝票と、それより後）。無ければ出さない */
  daypart?: {
    lunchUntil: string;
    dinnerFrom: string;
    lunch: { sales: number; groups: number; guests: number; avg: number };
    dinner: { sales: number; groups: number; guests: number; avg: number };
  };
  /** 控除＝返金・取消（点数・金額・内消費税・種類）。控除後純売上 ＝ 純売上 − (控除額 − 控除税額) */
  deductions?: { count: number; amount: number; tax: number; items: string[] };
  /** 訂正（黒伝票）＝会計後に作り直した再会計伝票 */
  corrections?: ReportCountAmount;
  /** 未回収＝掛売（まだ入金されていない会計） */
  uncollected?: ReportCountAmount;
  /** 領収書の発行枚数 */
  receipts?: { count: number };
  /** レジクローズ時 レジ実績入力（現金＝数えた在高。現金以外は記録どおりの額） */
  countedByMethod?: { label: string; amount: number }[];
  /** 預入（銀行振込・貸金庫預け・警備会社預け）。入力欄はまだ無く 0 */
  deposits?: { bank: number; safe: number; security: number };
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
    /** 開局の比較：前回のレジクローズで残した翌準備金（記録が無ければ null） */
    openingExpected?: number | null;
    /** 開局時の過不足 ＝ 釣銭準備金 − 前回の翌準備金 */
    openingDifference?: number | null;
    /** 開局時の過不足の理由 */
    openingDifferenceReason?: string | null;
    /** 締めで翌日のためにレジに残した額（翌準備金）。無ければ 釣銭準備金 と同じとみなす */
    nextFloat?: number | null;
    /** 締めでレジから出した額（預入金＝銀行・預り金） */
    depositAmount?: number | null;
    /** 翌準備金の目標に足りない額（準備金不足・マイナス） */
    floatShortage?: number;
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

/** 用紙幅・桁数から「行を作る道具」をそろえる（本紙と精算情報の紙で共通） */
function makeLineTools(options: RegisterReportOptions) {
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
  /** 【見出し】の区画。前に「空行・＿線・空行」 */
  const section = (title: string) => {
    blank();
    line(solid);
    blank();
    line(`【${title}】`);
    blank();
  };
  /** ＊見出し＊（真ん中）。前に空行 */
  const starSection = (title: string) => {
    blank();
    center(`＊${title}＊`);
  };
  const sub = (title: string) => line(`<${title}>`);
  const subSep = () => {
    blank();
    line(dotted);
    blank();
  };
  return { L, width, line, center, kv, kcv, blank, section, starSection, sub, subSep, solid, dotted };
}

/** 紙の一番上（レジ精算・店名・営業日・処理番号・締め） */
function reportHead(t: ReturnType<typeof makeLineTools>, data: RegisterReportData, title: string) {
  t.center(title, 'large');
  t.center(data.storeName);
  t.blank();
  t.line(`営業日: ${data.businessDateLabel}`);
  t.line(`処理番号: ${data.sessionNo}`);
  t.line(`締め: ${data.closedAtLabel}  ${data.closedBy}`);
}

/**
 * レジ精算レシートの本文（2026-09-28 Ronnie が3枚の紙から選んだ並び）。
 *   上：レジ精算・店名・営業日・処理番号・締め
 *   組数・客数・客単価 → ランチ／ディナー → 総売上点数・売上・税率・消費税・純売上 → 控除 →
 *   サービス料・深夜料 → 値割引・端数値引 → ＊支払情報＊（お預かり・おつり・取消・訂正・未回収・領収書）
 *   → ＊媒体別＊ → ＊入出金情報＊（入金・出金の明細も） → ＊レジクローズ時 レジ実績入力情報＊ → ＊業務履歴＊ → 印刷日時・担当者
 *   釣銭準備金〜金種の【精算情報】は本紙には出さず、別の紙（layoutSettlementReport）にした。
 *
 * 紙を 30cm 以内に（2026-09-28 Ronnie「スリップが長い。30cm にしたい」→ 相談で決めたこと）：
 *   - 空行・区切り線を減らし、ランチ／ディナー・媒体別は 2行、男性／女性は客数の行、内消費税は税率の行にまとめる
 *   - 媒体別の [全体]（上の 組数・客数・売上・客単価 と同じ）と、入出金が無い日の空の見出しは出さない
 *   - 0件・¥0 の行は出さない（現金・現金在高・差異合計・レジオープン時現金・レジ会計 は 0 でも出す）
 *   - 行間を 3mm に詰める（印字データ側：registerReportStarPrnt / registerReportEpos）
 */
export function layoutRegisterReport(data: RegisterReportData, options: RegisterReportOptions = {}): LayoutLine[] {
  const t = makeLineTools(options);
  const { line, kv, kcv, blank, starSection } = t;
  const s = data.sales;
  const taxTotal = s.tax ?? s.taxByRate.reduce((a, r) => a + r.tax, 0);
  const male = s.guestsMale ?? 0;
  const female = s.guestsFemale ?? 0;
  const unselected = Math.max(0, s.guests - male - female);
  const ded = data.deductions ?? { count: 0, amount: 0, tax: 0, items: [] };
  const lateNight = s.lateNight ?? { count: 0, amount: 0 };
  const rounding = s.rounding ?? { count: 0, amount: 0 };
  const cnt = (n: number) => `${n}件`;
  /** 0件・¥0 の行は出さない */
  const nonZero = (x: { count: number; amount: number }) => x.count !== 0 || x.amount !== 0;
  const cashLabel = (label: string) => label === '現金';

  reportHead(t, data, 'レジ精算');
  line(t.dotted);

  // ---- 客数・売上 ----
  kv('組数', `${s.groups}組`);
  const genders = [
    ['男性', male],
    ['女性', female],
    ['選択なし', unselected],
  ] as const;
  // 男性・女性が入っている日だけ内訳を出す（0 の区分は出さない）
  const genderNote =
    male + female > 0
      ? `（${genders
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}${n}`)
          .join('・')}）`
      : '';
  kv(`客数${genderNote}`, `${s.guests}客`);
  kv('客単価', yen(s.avgSpend));
  // ---- ランチ／ディナー（区切りの時刻は店の設定。紙には時刻を出さない：2026-09-28 Ronnie「（〜15:00）（15:01〜）は要らない」） ----
  if (data.daypart) {
    const parts = [
      ['ランチ売上', data.daypart.lunch],
      ['ディナー売上', data.daypart.dinner],
    ] as const;
    for (const [label, p] of parts) {
      if (p.groups === 0 && p.sales === 0) continue;
      kv(label, yen(p.sales));
      kv(`  ${p.groups}組 ${p.guests}名様 単価`, yen(p.avg));
    }
  }
  kv('総売上点数', `${s.itemQuantity}点`);
  kv('売上', yen(s.gross));
  // 税率は売上のあった率だけ（10% は常に）。内消費税はその率の分を同じ行に
  const rates = s.taxByRate.filter((r) => r.rate === 10 || r.taxable > 0).sort((a, b) => b.rate - a.rate);
  if (!rates.some((r) => r.rate === 10)) rates.unshift({ rate: 10, taxable: 0, tax: 0 });
  for (const r of rates) {
    kv(r.rate === 0 ? '税率  非課税' : `税率  ${r.rate}% (内消費税 ${yen(r.tax)})`, yen(r.taxable));
  }
  kv('消費税', yen(taxTotal));
  kv('純売上', yen(s.net));
  // ---- 控除（返金・取消）。無い日は出さない ----
  if (ded.count !== 0 || ded.amount !== 0) {
    kcv('控除', `${ded.count}点`, yen(ded.amount));
    if (ded.items.length) line(`  控除項目 ${ded.items.join('・')}`);
    kv('  控除項目税額', yen(ded.tax));
    kv('控除後純売上', yen(s.net - (ded.amount - ded.tax)));
  }
  if (nonZero(data.surcharges)) kcv('サービス料', cnt(data.surcharges.count), yen(data.surcharges.amount));
  if (nonZero(lateNight)) kcv('深夜料', cnt(lateNight.count), yen(lateNight.amount));
  if (nonZero(data.discounts)) kcv('値割引', cnt(data.discounts.count), yen(data.discounts.amount));
  if (nonZero(rounding)) kcv('端数値引', cnt(rounding.count), yen(rounding.amount));

  // ---- 支払情報（現金は 0 でも出す） ----
  starSection('支払情報');
  const payments = data.payments.filter((p) => cashLabel(p.label) || nonZero(p));
  if (payments.length === 0) line('会計はありません');
  for (const p of payments) kcv(p.label, cnt(p.count), yen(p.amount));
  if (data.cash.tendered !== 0 || data.cash.change !== 0) {
    kv('お預かり現金', yen(data.cash.tendered));
    kv('おつり', yen(data.cash.change));
  }
  const voids = data.activity.find((a) => a.label.startsWith('取消'));
  const voidRow = { count: voids?.count ?? 0, amount: Math.abs(voids?.amount ?? 0) };
  if (nonZero(voidRow)) kcv('取消（赤伝票）', cnt(voidRow.count), yen(voidRow.amount));
  if (data.corrections && nonZero(data.corrections)) kcv('訂正（黒伝票）', cnt(data.corrections.count), yen(data.corrections.amount));
  if (data.uncollected && nonZero(data.uncollected)) kcv('未回収', cnt(data.uncollected.count), yen(data.uncollected.amount));
  const receiptCount = data.receipts?.count ?? data.activity.find((a) => a.label === '領収書発行')?.count ?? 0;
  if (receiptCount > 0) kv('領収書', cnt(receiptCount));

  // ---- 媒体別（お客様情報の来店経路ごと。2026-09-28 Ronnie「来店経路の選択のデータをレジ精算に」）。
  //      [全体] は上の 組数・客数・売上・客単価 と同じなので出さない ----
  const channels = data.byChannel.filter((c) => c.label !== '全体');
  if (channels.length > 0) {
    starSection('媒体別（税込）');
    for (const c of channels) {
      kv(c.label, yen(c.sales));
      kv(`  ${c.groups}組 ${c.guests}人 客単価`, c.guests > 0 ? yen(Math.round(c.sales / c.guests)) : yen(0));
    }
  }

  // ---- 入出金情報（件数・明細と現金在高） ----
  starSection('入出金情報');
  kcv('レジオープン時現金', '1件', yen(data.cash.openingFloat));
  if (data.cashIns.length > 0 || data.cash.cashIn !== 0) {
    kcv('入金', cnt(data.cashIns.length), yen(data.cash.cashIn));
    for (const x of data.cashIns) kv(`  ${x.purpose}`, yen(x.amount));
  }
  if (data.cashOuts.length > 0 || data.cash.cashOut !== 0) {
    kcv('出金', cnt(data.cashOuts.length), yen(data.cash.cashOut));
    for (const x of data.cashOuts) kv(`  ${x.purpose}`, `-${yen(x.amount)}`);
  }
  kv('現金在高', data.cash.counted == null ? yen(data.cash.expected) : yen(data.cash.counted));

  // ---- レジクローズ時 レジ実績入力情報（現金・差異合計は 0 でも出す） ----
  starSection('レジクローズ時 レジ実績入力情報');
  const counted = data.countedByMethod ?? [
    { label: '現金', amount: data.cash.counted ?? data.cash.expected },
    ...data.payments.filter((p) => p.label !== '現金').map((p) => ({ label: p.label, amount: p.amount })),
  ];
  for (const c of counted) if (cashLabel(c.label) || c.amount !== 0) kv(c.label, yen(c.amount));
  kv('差異合計', data.cash.difference == null ? '未入力' : signedYen(data.cash.difference));
  const reason = data.differenceReason?.trim();
  if (reason || (data.cash.difference != null && data.cash.difference !== 0)) kv('差異理由', reason || '未選択');
  const dep = data.deposits ?? { bank: 0, safe: 0, security: 0 };
  if (dep.bank !== 0) kv('銀行振込', yen(dep.bank));
  if (dep.safe !== 0) kv('貸金庫預け', yen(dep.safe));
  if (dep.security !== 0) kv('警備会社預け', yen(dep.security));

  // ---- 業務履歴（0件の行は出さない。レジ会計は出す） ----
  starSection('業務履歴');
  for (const a of data.activity) {
    if (a.label !== 'レジ会計' && a.count === 0) continue;
    kcv(a.label, cnt(a.count), a.amount < 0 ? `-${yen(-a.amount)}` : yen(a.amount));
  }

  blank();
  if (data.note) line(`備考: ${data.note}`);
  line(`印刷日時: ${data.printedAtLabel}`);
  line(`担当者: ${data.closedBy}`);
  return t.L;
}

/**
 * 精算情報の紙（釣銭準備金〜金種）。本紙には出さず、レジクローズの「精算情報を印刷」を押したときだけ出す
 * （2026-09-28 Ronnie「精算情報はレジクローズのオプション。メインには要らない」）。
 */
export function layoutSettlementReport(data: RegisterReportData, options: RegisterReportOptions = {}): LayoutLine[] {
  const t = makeLineTools(options);
  const { line, kv, kcv, blank, section, sub, subSep } = t;
  const c = data.cash;
  const dep = data.deposits ?? { bank: 0, safe: 0, security: 0 };
  const nextFloat = c.nextFloat ?? c.openingFloat;
  const collected = c.depositAmount ?? (c.counted == null ? null : Math.max(0, c.counted - nextFloat));
  const depositTotal = c.depositAmount ?? dep.bank + dep.safe + dep.security;

  reportHead(t, data, 'レジ精算 精算情報');
  section('精算情報');
  kv('釣銭準備金', yen(c.openingFloat));
  // 開局で数えた額と、前回のレジクローズで残した額（翌準備金）の比較（2026-09-28 Ronnie）
  if (c.openingExpected != null) {
    kv('  前回の翌準備金', yen(c.openingExpected));
    kv('  開局時過不足', signedYen(c.openingDifference ?? c.openingFloat - c.openingExpected));
    if (c.openingDifferenceReason?.trim()) kv('  過不足理由', c.openingDifferenceReason.trim());
  }
  kv('現金受領', yen(c.cashSales));
  if (c.cashRefunds > 0) kv('現金返金', `-${yen(c.cashRefunds)}`);
  kv('入出金計', signedYen(c.cashIn - c.cashOut));
  kv('回収金額', collected == null ? '未入力' : yen(collected));
  blank();
  kv('想定金額', yen(c.expected));
  kv('在高実績', c.counted == null ? '未入力' : yen(c.counted));
  kv('差額', c.difference == null ? '未入力' : signedYen(c.difference));
  kv('差異理由', data.differenceReason?.trim() || '未選択');
  blank();
  kv('翌準備金', yen(nextFloat));
  if ((c.floatShortage ?? 0) > 0) kv('準備金不足', `-${yen(c.floatShortage ?? 0)}`);
  kv('預入金', yen(depositTotal));
  kv('  銀行振込', yen(dep.bank));
  kv('  貸金庫預け', yen(dep.safe));
  kv('  警備会社預け', yen(dep.security));
  if (c.denominations) {
    subSep();
    sub('金種');
    for (const d of CASH_DENOMINATIONS) {
      const n = c.denominations[d] ?? 0;
      kcv(denominationReportLabel(d), `${n}枚`, yen(d * n));
    }
  }
  blank();
  line(`印刷日時: ${data.printedAtLabel}`);
  line(`担当者: ${data.closedBy}`);
  blank();
  return t.L;
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
