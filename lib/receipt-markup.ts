/**
 * ReceiptData → Star Document Markup（text/vnd.star.markup）変換（純関数・テスト対象）。
 * Star mC-Print3 等の CloudPRNT 対応機がこのMarkupを解釈して感熱レシートを印字する。
 * 使用するMarkup命令は公式確認済みのものに限定する:
 *   [align: middle|left|right] / [magnify: width N; height N] / [bold: on|off] / [feed] / [cut: feed; partial]
 * 本文は全体を [bold: on]（強調）で印字する（店舗要望「文字を少し太く」。感熱紙で読みやすくする）。
 * キャッシュドロアはMarkupに機種依存があるため drawerKickMarkup() で別ジョブとして扱う。
 */
import type { ReceiptData } from './receipts';
import { billSlipLines, colsFor, twoCol as twoColBase, wrapText as wrapTextBase, yen, STAR_WIDTH_OPTIONS, type PaperWidth } from './receipt-layout';

/** Star 機の全角幅（半角2桁よりわずかに広い）を見込んだ桁揃え・折り返し */
const twoCol = (left: string, right: string, width: number) => twoColBase(left, right, width, STAR_WIDTH_OPTIONS);
const wrapText = (text: string, width: number) => wrapTextBase(text, width, STAR_WIDTH_OPTIONS);
import type { KitchenTicketBuzzer, LayoutLine } from './kitchen-ticket';
import { splitLabel, type RyoshushoSlip } from './ryoshusho-split';

/** Markup構文で意味を持つ文字を無害化（角括弧・バックスラッシュ）。 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export interface ReceiptMarkupOptions {
  paperWidth?: PaperWidth;
}

export function receiptToStarMarkup(receipt: ReceiptData, options: ReceiptMarkupOptions = {}): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const L: string[] = [];
  const line = (s = '') => { for (const w of wrapText(s, width)) L.push(esc(w)); };
  const raw = (s: string) => L.push(s); // Markup命令はエスケープしない

  raw('[bold: on]');
  raw('[align: middle]');
  if (receipt.isReissue) line('※ 再発行');
  if (receipt.isRefundReceipt) line('※ 返金レシート');

  raw('[magnify: width 1; height 2]');
  line(receipt.storeName);
  raw('[magnify: width 1; height 1]');
  if (receipt.storeAddress) line(receipt.storeAddress);
  if (receipt.storePhone) line(`TEL ${receipt.storePhone}`);
  raw('[align: left]');
  if (receipt.registrationNumber) line(`登録番号 ${receipt.registrationNumber}`);
  line(rule);
  line(`発行 ${receipt.issuedAt}`);
  line(twoCol(`No.${receipt.orderNo}`, [receipt.registerName, receipt.staffName].filter(Boolean).join(' '), width));
  if (receipt.tableName) line(`卓 ${receipt.tableName}`);
  line(rule);

  // 明細
  for (const it of receipt.lines) {
    if (it.cancelled) continue;
    line(it.name);
    line(twoCol(`  ${it.quantity} x ${yen(it.unitPrice)}`, yen(it.lineTotal), width));
    for (const m of it.modifiers) {
      line(twoCol(`   + ${m.name}`, m.price ? yen(m.price) : '', width));
    }
  }
  line(rule);

  // 金額
  line(twoCol('小計', yen(receipt.subtotal), width));
  for (const t of receipt.taxRows) {
    line(twoCol(`  (税${t.rate}%対象 ${yen(t.taxable)})`, `税${yen(t.tax)}`, width));
  }
  if (receipt.serviceCharge > 0) line(twoCol('サービス料', yen(receipt.serviceCharge), width));
  if (receipt.discount > 0) {
    line(twoCol(`値引${receipt.couponCode ? ` (${receipt.couponCode})` : ''}`, `-${yen(receipt.discount)}`, width));
  }
  raw('[magnify: width 1; height 2]');
  line(twoCol('合計', yen(receipt.total), width));
  raw('[magnify: width 1; height 1]');
  line(rule);

  // 支払
  for (const p of receipt.payments) line(twoCol(p.label, yen(p.amount), width));
  if (receipt.tendered != null) line(twoCol('お預り', yen(receipt.tendered), width));
  if (receipt.change != null) line(twoCol('お釣り', yen(receipt.change), width));
  if (receipt.refundTotal > 0) {
    line(twoCol('返金', `-${yen(receipt.refundTotal)}`, width));
    line(twoCol('差引', yen(receipt.netPaid), width));
  }
  if (receipt.pointsEarned != null || receipt.pointsUsed != null) {
    line(rule);
    if (receipt.pointsUsed) line(twoCol('利用ポイント', `${receipt.pointsUsed}P`, width));
    if (receipt.pointsEarned) line(twoCol('獲得ポイント', `${receipt.pointsEarned}P`, width));
    if (receipt.pointBalance != null) line(twoCol('ポイント残高', `${receipt.pointBalance}P`, width));
  }
  line(rule);

  raw('[align: middle]');
  if (receipt.footerMessage) {
    for (const fl of receipt.footerMessage.split('\n')) line(fl);
  }
  line(`照会番号 ${receipt.qrContent}`);
  raw('[feed]');
  raw('[cut: feed; partial]');

  return L.join('\n') + '\n';
}

export interface RyoshushoOptions extends ReceiptMarkupOptions {
  /** 宛名（空欄なら「上様」） */
  recipientName?: string | null;
  /** 但し書き（空欄なら「お品代として」） */
  purpose?: string | null;
  /**
   * 分割発行の1枚ぶん。会計は分けず、証憑だけを分ける（lib/ryoshusho-split.ts）。
   * 渡すと金額はこの1枚ぶんになり、見出しに「(2/4)」が付く。
   */
  split?: RyoshushoSlip | null;
}

/**
 * 領収書（Markup）。レシートとは別物として組む。
 * 「領収書」の見出し・宛名・金額（大きく）・但し書き・内訳（税率別）・登録番号を印字する。
 * 5万円以上は収入印紙欄を出す（印紙の貼付・消印は店舗側の運用）。
 */
export function ryoshushoToStarMarkup(receipt: ReceiptData, options: RyoshushoOptions = {}): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const L: string[] = [];
  const line = (s = '') => { for (const w of wrapText(s, width)) L.push(esc(w)); };
  const raw = (s: string) => L.push(s);

  const recipient = (options.recipientName ?? '').trim() || '上様';
  const purpose = (options.purpose ?? '').trim() || 'お品代として';

  const split = options.split ?? null;
  const amount = split ? split.amount : receipt.netPaid;

  raw('[bold: on]');
  raw('[align: middle]');
  if (receipt.isReissue) line('※ 再発行');
  raw('[magnify: width 1; height 2]');
  line('領 収 書');
  raw('[magnify: width 1; height 1]');
  if (split && split.count > 1) line(`${splitLabel(split)} 分割発行`);
  line();

  raw('[align: left]');
  line(`${recipient} 様`);
  line(rule);

  // 金額（いちばん大きく）。一部返金がある場合は実際に受け取った額（netPaid）を領収額とする。
  // 分割発行のときはこの1枚ぶんの金額だけを出す（合計は下に but し書きとして残す）
  raw('[align: middle]');
  raw('[magnify: width 1; height 2]');
  line(`${yen(amount)}`);
  raw('[magnify: width 1; height 1]');
  raw('[align: left]');
  line(`但 ${purpose}`);
  line('上記正に領収いたしました');
  line(rule);

  // 内訳。分割発行のときは、この1枚ぶんの消費税と「全体のうちいくらか」だけを出す
  // （税率ごとの対象額をそのまま載せると、1枚で全額を領収したように読めてしまうため）
  if (split && split.count > 1) {
    line(twoCol('内消費税', yen(split.tax), width));
    line(twoCol(`合計 ${yen(receipt.netPaid)} のうち`, `${split.index}/${split.count}`, width));
  } else {
    line(twoCol('小計', yen(receipt.subtotal), width));
    for (const t of receipt.taxRows) {
      line(twoCol(`  (税${t.rate}%対象 ${yen(t.taxable)})`, `税${yen(t.tax)}`, width));
    }
    if (receipt.serviceCharge > 0) line(twoCol('サービス料', yen(receipt.serviceCharge), width));
    if (receipt.discount > 0) line(twoCol('値引', `-${yen(receipt.discount)}`, width));
    line(twoCol('合計', yen(receipt.total), width));
    if (receipt.payments.length > 0) {
      line(twoCol('お支払方法', receipt.payments.map((p) => p.label).join(' / '), width));
    }
  }
  line(rule);

  // 発行元
  line(receipt.storeName);
  if (receipt.storeAddress) line(receipt.storeAddress);
  if (receipt.storePhone) line(`TEL ${receipt.storePhone}`);
  if (receipt.registrationNumber) line(`登録番号 ${receipt.registrationNumber}`);
  line(twoCol(`発行 ${receipt.issuedAt}`, `No.${receipt.orderNo}`, width));
  // 収入印紙は「1枚の領収額」で決まるので、分割したらこの1枚の金額で見る
  if (amount >= 50000) {
    line();
    line('[ 収入印紙 ]');
  }
  raw('[feed]');
  raw('[cut: feed; partial]');

  return L.join('\n') + '\n';
}

/**
 * 注文伝票（会計前の中間伝票・お客様確認用）。
 * 会計を確定せずに、現在の注文内容と合計をレシートプリンターに出す。
 */
export function orderSlipMarkup(
  slip: {
    storeName: string;
    orderNo: string;
    tableName: string | null;
    guestCount: number | null;
    clerkName: string | null;
    issuedAt: string;
    lines: { name: string; quantity: number; unitPrice: number; lineTotal: number; modifiers: { name: string; price: number }[] }[];
    subtotal: number;
    taxTotal: number;
    serviceCharge: number;
    discount: number;
    total: number;
  },
  options: ReceiptMarkupOptions = {}
): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const L: string[] = [];
  const line = (s = '') => { for (const w of wrapText(s, width)) L.push(esc(w)); };
  const raw = (s: string) => L.push(s);

  raw('[bold: on]');
  raw('[align: middle]');
  raw('[magnify: width 1; height 2]');
  line('お会計伝票');
  raw('[magnify: width 1; height 1]');
  line(slip.storeName);
  line('（会計前のご確認用）');
  raw('[align: left]');
  line(rule);
  line(twoCol(slip.tableName ?? 'テイクアウト', `No.${slip.orderNo}`, width));
  const meta = [slip.guestCount ? `${slip.guestCount}名` : null, slip.clerkName ? `担当 ${slip.clerkName}` : null]
    .filter(Boolean)
    .join('  ');
  if (meta) line(meta);
  line(`発行 ${slip.issuedAt}`);
  line(rule);

  for (const it of billSlipLines(slip.lines)) {
    line(it.name);
    line(twoCol(`  ${it.quantity} x ${yen(it.unitPrice)}`, yen(it.lineTotal), width));
    for (const m of it.modifiers) line(twoCol(`   + ${m.name}`, m.price ? yen(m.price) : '', width));
  }
  line(rule);
  line(twoCol('小計', yen(slip.subtotal), width));
  line(twoCol('消費税', yen(slip.taxTotal), width));
  if (slip.serviceCharge > 0) line(twoCol('サービス料', yen(slip.serviceCharge), width));
  if (slip.discount > 0) line(twoCol('値引', `-${yen(slip.discount)}`, width));
  raw('[magnify: width 1; height 2]');
  line(twoCol('合計', yen(slip.total), width));
  raw('[magnify: width 1; height 1]');
  line(rule);
  raw('[align: middle]');
  line('※ これは領収書ではありません');
  raw('[feed]');
  raw('[cut: feed; partial]');

  return L.join('\n') + '\n';
}

/**
 * キャッシュドロアを開くMarkup。機種/ファームで方言が異なり得るため、
 * コマンド文字列は printer_configs.drawer_command で調整可能にしている（既定 '[drawer: 1]'）。
 */
export function drawerKickMarkup(command: string): string {
  const cmd = (command || '[drawer: 1]').trim();
  return `${cmd}\n`;
}

/** 接続確認用のテスト印字Markup。実注文を使わずにプリンタの疎通と文字化けを確認できる。 */
export function testPrintMarkup(opts: { storeName: string; paperWidth?: PaperWidth; issuedAt: string }): string {
  const width = colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  return [
    '[bold: on]',
    '[align: middle]',
    '[magnify: width 1; height 2]',
    esc(opts.storeName || 'TENPO ONE'),
    '[magnify: width 1; height 1]',
    'CloudPRNT テスト印刷',
    '[align: left]',
    rule,
    esc(twoCol('接続', 'OK', width)),
    esc(twoCol('用紙幅', `${opts.paperWidth ?? 80}mm`, width)),
    esc(twoCol('発行', opts.issuedAt, width)),
    esc('日本語テスト：シュラスコ ¥1,234'),
    rule,
    // 全角幅の物差し（折り返さずに送る）。全角24文字＝半角48桁ぶん。末尾が次行に落ちる文字数で全角の実幅が分かる
    '全角24文字（末尾が次行に落ちれば全角が半角2桁より広い機種）',
    '田'.repeat(24),
    rule,
    '[align: middle]',
    'このレシートが正しく印字されれば接続成功です',
    '[feed]',
    '[cut: feed; partial]',
    '',
  ].join('\n');
}

/** 厨房伝票（Markup）。行の組み立ては lib/kitchen-ticket.ts と共有する。 */
export function kitchenTicketMarkup(lines: LayoutLine[]): string {
  const L: string[] = ['[bold: on]'];
  let align = '';
  let size = '';
  for (const l of lines) {
    const a = l.align === 'center' ? '[align: middle]' : '[align: left]';
    if (a !== align) {
      L.push(a);
      align = a;
    }
    const s =
      l.size === 'large'
        ? '[magnify: width 2; height 2]'
        : l.size === 'tall'
          ? '[magnify: width 1; height 2]'
          : '[magnify: width 1; height 1]';
    if (s !== size) {
      L.push(s);
      size = s;
    }
    L.push(esc(l.text));
  }
  if (size !== '[magnify: width 1; height 1]') L.push('[magnify: width 1; height 1]');
  L.push('[feed]');
  L.push('[cut: feed; partial]');
  return L.join('\n') + '\n';
}

/**
 * 厨房伝票を複数枚続けて出す（商品の種類ごとに1枚）。1枚ごとに紙を切る。
 * 1回の注文を1つの印刷ジョブにまとめるので、ポーリング1回で全部出て、順番も崩れない。
 */
export function kitchenTicketsMarkup(slips: LayoutLine[][], opts: { buzzer?: KitchenTicketBuzzer } = {}): string {
  return slips.map((lines) => kitchenTicketMarkup(lines)).join('') + buzzerMarkup(opts.buzzer);
}

/**
 * 厨房伝票のブザー（Markup）。ドロア端子につないだブザーを1度だけ鳴らす。
 * Markup ではドロアと同じ命令で端子を叩く。none のときは空文字。
 */
export function buzzerMarkup(buzzer: KitchenTicketBuzzer | undefined): string {
  if (buzzer === 'drawer1') return '[drawer: 1]\n';
  if (buzzer === 'drawer2') return '[drawer: 2]\n';
  return '';
}
