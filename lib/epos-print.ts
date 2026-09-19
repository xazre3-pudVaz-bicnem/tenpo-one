/**
 * ePOS-Print XML（EPSON TM プリンター用）。
 *
 * 銀座・高田馬場の Star mC-Print3 は CloudPRNT（lib/receipt-markup.ts / lib/starprnt.ts）で印字するが、
 * 御茶ノ水は EPSON のため CloudPRNT が使えない。EPSON は「Server Direct Print」で
 * プリンター側から定期的にサーバーへ問い合わせ、サーバーが ePOS-Print XML を返すと印字する。
 * 対応機は TM-i シリーズ・TM-T88VI / TM-T88VI-iHUB・TM-DT シリーズ。
 *
 * TODO(整理): レイアウト（どの行に何を出すか）は Markup 版・StarPRNT 版と同じ内容を
 * 3か所に書いている。将来 LayoutLine[] を作る関数へ一本化して、各レンダラは
 * 「LayoutLine[] → 各形式」だけにするのが望ましい。今は稼働中の Star 側を壊さないため分けている。
 */
import type { ReceiptData } from './receipts';
import { colsFor, twoCol, yen, type PaperWidth } from './receipt-layout';
import type { LayoutLine } from './kitchen-ticket';
import type { OrderSlipData } from './starprnt';

const EPOS_NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

/** XMLとして安全な文字列にする */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type Align = 'left' | 'center' | 'right';

interface TextAttrs {
  align?: Align;
  /** 横倍率 1〜8 */
  width?: number;
  /** 縦倍率 1〜8 */
  height?: number;
  em?: boolean;
}

/**
 * ePOS-Print XML の本文を組み立てる。
 * 文字コードは UTF-8 のまま（CP932 変換は不要。lang="ja" でプリンター側が処理する）。
 */
export class EposBuilder {
  private parts: string[] = [];

  /** 1行印字（末尾に改行を入れる） */
  line(text = '', attrs: TextAttrs = {}): this {
    const a: string[] = ['lang="ja"'];
    if (attrs.align) a.push(`align="${attrs.align}"`);
    if (attrs.width && attrs.width > 1) a.push(`width="${Math.min(8, Math.floor(attrs.width))}"`);
    if (attrs.height && attrs.height > 1) a.push(`height="${Math.min(8, Math.floor(attrs.height))}"`);
    if (attrs.em) a.push('em="true"');
    // 空行も改行だけは送る（レイアウトの余白を保つため）
    this.parts.push(`<text ${a.join(' ')}>${escapeXml(text)}&#10;</text>`);
    return this;
  }

  /** 紙送り（行数） */
  feed(lines = 1): this {
    this.parts.push(`<feed line="${Math.max(1, Math.floor(lines))}"/>`);
    return this;
  }

  /** カット（用紙を送ってから部分カット） */
  cut(): this {
    this.parts.push('<cut type="feed"/>');
    return this;
  }

  /** キャッシュドロア開放。drawer_1 = ピン2番（一般的な配線） */
  pulse(drawer: 'drawer_1' | 'drawer_2' = 'drawer_1'): this {
    this.parts.push(`<pulse drawer="${drawer}" time="pulse_100"/>`);
    return this;
  }

  toXml(): string {
    return `<epos-print xmlns="${EPOS_NS}">${this.parts.join('')}</epos-print>`;
  }
}

/** LayoutLine のサイズ指定を ePOS の倍率に写す */
function sizeAttrs(size: LayoutLine['size']): TextAttrs {
  if (size === 'large') return { width: 2, height: 2 };
  if (size === 'tall') return { height: 2 };
  return {};
}

export interface EposOptions {
  paperWidth?: PaperWidth;
}

/** レシート（ePOS-Print XML）。Markup版 receiptToStarMarkup と同じ並び。 */
export function receiptToEposXml(receipt: ReceiptData, options: EposOptions = {}): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const b = new EposBuilder();

  if (receipt.isReissue) b.line('※ 再発行', { align: 'center' });
  if (receipt.isRefundReceipt) b.line('※ 返金レシート', { align: 'center' });
  b.line(receipt.storeName, { align: 'center', width: 2, height: 2 });
  if (receipt.storeAddress) b.line(receipt.storeAddress, { align: 'center' });
  if (receipt.storePhone) b.line(`TEL ${receipt.storePhone}`, { align: 'center' });

  if (receipt.registrationNumber) b.line(`登録番号 ${receipt.registrationNumber}`, { align: 'left' });
  b.line(rule, { align: 'left' });
  b.line(`発行 ${receipt.issuedAt}`);
  b.line(twoCol(`No.${receipt.orderNo}`, [receipt.registerName, receipt.staffName].filter(Boolean).join(' '), width));
  b.line(rule);

  for (const it of receipt.lines) {
    if (it.cancelled) continue;
    b.line(it.name);
    b.line(twoCol(`  ${it.quantity} x ${yen(it.unitPrice)}`, yen(it.lineTotal), width));
    for (const m of it.modifiers) b.line(twoCol(`   + ${m.name}`, m.price ? yen(m.price) : '', width));
  }
  b.line(rule);

  b.line(twoCol('小計', yen(receipt.subtotal), width));
  for (const t of receipt.taxRows) {
    b.line(twoCol(`  (税${t.rate}%対象 ${yen(t.taxable)})`, `税${yen(t.tax)}`, width));
  }
  if (receipt.serviceCharge > 0) b.line(twoCol('サービス料', yen(receipt.serviceCharge), width));
  if (receipt.discount > 0) {
    b.line(twoCol(`値引${receipt.couponCode ? ` (${receipt.couponCode})` : ''}`, `-${yen(receipt.discount)}`, width));
  }
  // 横倍なので桁数は半分で揃える
  b.line(twoCol('合計', yen(receipt.total), Math.floor(width / 2)), { width: 2 });
  b.line(rule);

  for (const p of receipt.payments) b.line(twoCol(p.label, yen(p.amount), width));
  if (receipt.tendered != null) b.line(twoCol('お預り', yen(receipt.tendered), width));
  if (receipt.change != null) b.line(twoCol('お釣り', yen(receipt.change), width));
  if (receipt.refundTotal > 0) {
    b.line(twoCol('返金', `-${yen(receipt.refundTotal)}`, width));
    b.line(twoCol('差引', yen(receipt.netPaid), width));
  }
  if (receipt.pointsEarned != null || receipt.pointsUsed != null) {
    b.line(rule);
    if (receipt.pointsUsed) b.line(twoCol('利用ポイント', `${receipt.pointsUsed}P`, width));
    if (receipt.pointsEarned) b.line(twoCol('獲得ポイント', `${receipt.pointsEarned}P`, width));
    if (receipt.pointBalance != null) b.line(twoCol('ポイント残高', `${receipt.pointBalance}P`, width));
  }
  b.line(rule);

  if (receipt.footerMessage) {
    for (const fl of receipt.footerMessage.split('\n')) b.line(fl, { align: 'center' });
  }
  b.line(`照会番号 ${receipt.qrContent}`, { align: 'center' });
  b.feed().cut();
  return b.toXml();
}

export interface RyoshushoEposOptions extends EposOptions {
  recipientName?: string | null;
  purpose?: string | null;
}

/** 領収書（ePOS-Print XML）。Markup版 ryoshushoToStarMarkup と同じ並び。 */
export function ryoshushoToEposXml(receipt: ReceiptData, options: RyoshushoEposOptions = {}): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const b = new EposBuilder();
  const recipient = (options.recipientName ?? '').trim() || '上様';
  const purpose = (options.purpose ?? '').trim() || 'お品代として';

  if (receipt.isReissue) b.line('※ 再発行', { align: 'center' });
  b.line('領 収 書', { align: 'center', width: 2, height: 2 });
  b.line('', { align: 'center' });
  b.line(`${recipient} 様`, { align: 'left' });
  b.line(rule);
  // 領収額は返金を差し引いた実受領額
  b.line(yen(receipt.netPaid), { align: 'center', width: 2, height: 2 });
  b.line(`但 ${purpose}`, { align: 'left' });
  b.line('上記正に領収いたしました');
  b.line(rule);

  b.line(twoCol('小計', yen(receipt.subtotal), width));
  for (const t of receipt.taxRows) {
    b.line(twoCol(`  (税${t.rate}%対象 ${yen(t.taxable)})`, `税${yen(t.tax)}`, width));
  }
  if (receipt.serviceCharge > 0) b.line(twoCol('サービス料', yen(receipt.serviceCharge), width));
  if (receipt.discount > 0) b.line(twoCol('値引', `-${yen(receipt.discount)}`, width));
  b.line(twoCol('合計', yen(receipt.total), width));
  if (receipt.payments.length > 0) {
    b.line(twoCol('お支払方法', receipt.payments.map((p) => p.label).join(' / '), width));
  }
  b.line(rule);

  b.line(receipt.storeName);
  if (receipt.storeAddress) b.line(receipt.storeAddress);
  if (receipt.storePhone) b.line(`TEL ${receipt.storePhone}`);
  if (receipt.registrationNumber) b.line(`登録番号 ${receipt.registrationNumber}`);
  b.line(twoCol(`発行 ${receipt.issuedAt}`, `No.${receipt.orderNo}`, width));
  if (receipt.netPaid >= 50000) {
    b.line('');
    b.line('[ 収入印紙 ]');
  }
  b.feed().cut();
  return b.toXml();
}

/** 注文伝票（ePOS-Print XML）。会計前のお客様確認用。 */
export function orderSlipEposXml(slip: OrderSlipData, options: EposOptions = {}): string {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const b = new EposBuilder();

  b.line('注文伝票', { align: 'center', width: 2, height: 2 });
  b.line(slip.storeName, { align: 'center' });
  b.line('（会計前のご確認用）', { align: 'center' });
  b.line(rule, { align: 'left' });
  b.line(twoCol(slip.tableName ?? 'テイクアウト', `No.${slip.orderNo}`, width));
  const meta = [slip.guestCount ? `${slip.guestCount}名` : null, slip.clerkName ? `担当 ${slip.clerkName}` : null]
    .filter(Boolean)
    .join('  ');
  if (meta) b.line(meta);
  b.line(`発行 ${slip.issuedAt}`);
  b.line(rule);

  for (const it of slip.lines) {
    b.line(it.name);
    b.line(twoCol(`  ${it.quantity} x ${yen(it.unitPrice)}`, yen(it.lineTotal), width));
    for (const m of it.modifiers) b.line(twoCol(`   + ${m.name}`, m.price ? yen(m.price) : '', width));
  }
  b.line(rule);
  b.line(twoCol('小計', yen(slip.subtotal), width));
  b.line(twoCol('消費税', yen(slip.taxTotal), width));
  if (slip.serviceCharge > 0) b.line(twoCol('サービス料', yen(slip.serviceCharge), width));
  if (slip.discount > 0) b.line(twoCol('値引', `-${yen(slip.discount)}`, width));
  b.line(twoCol('合計', yen(slip.total), Math.floor(width / 2)), { width: 2 });
  b.line(rule);
  b.line('※ これは領収書ではありません', { align: 'center' });
  b.feed().cut();
  return b.toXml();
}

/** 厨房伝票（ePOS-Print XML）。行の組み立ては lib/kitchen-ticket.ts と共有する。 */
export function kitchenTicketEposXml(lines: LayoutLine[]): string {
  const b = new EposBuilder();
  for (const l of lines) {
    b.line(l.text, { align: l.align, ...sizeAttrs(l.size) });
  }
  b.feed().cut();
  return b.toXml();
}

/** 接続確認用のテスト印刷（ePOS-Print XML） */
export function testPrintEposXml(opts: { storeName: string; paperWidth?: PaperWidth; issuedAt: string }): string {
  const width = colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  const b = new EposBuilder();
  b.line(opts.storeName || 'TENPO ONE', { align: 'center', width: 2, height: 2 });
  b.line('EPSON Server Direct Print テスト印刷', { align: 'center' });
  b.line(rule, { align: 'left' });
  b.line(twoCol('接続', 'OK', width));
  b.line(twoCol('用紙幅', `${opts.paperWidth ?? 80}mm`, width));
  b.line(twoCol('発行', opts.issuedAt, width));
  b.line('日本語テスト：シュラスコ ¥1,234');
  b.line(rule);
  b.line('このレシートが正しく印字されれば接続成功です', { align: 'center' });
  b.feed().cut();
  return b.toXml();
}

/** キャッシュドロアのみを開く（ePOS-Print XML） */
export function drawerKickEposXml(drawer: 'drawer_1' | 'drawer_2' = 'drawer_1'): string {
  return new EposBuilder().pulse(drawer).toXml();
}

/**
 * Server Direct Print の応答エンベロープ。
 * プリンターは印字すべき内容をこの形で受け取り、印字後に結果を別リクエストで返す。
 */
export function serverDirectPrintEnvelope(eposXml: string, opts: { timeoutMs?: number } = {}): string {
  const timeout = Math.max(1000, Math.floor(opts.timeoutMs ?? 10000));
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<PrintRequestInfo Version="1.00">' +
    '<ePOSPrint>' +
    `<Parameter><devid>local_printer</devid><timeout>${timeout}</timeout></Parameter>` +
    `<PrintData>${eposXml}</PrintData>` +
    '</ePOSPrint>' +
    '</PrintRequestInfo>'
  );
}

/**
 * プリンターが印字後に送ってくる結果XML（ResponseFile）から成否を読む。
 * 解析できない場合は「成功扱いにしない」（印字されていないジョブを printed にしないため）。
 */
export function parseServerDirectPrintResult(responseFile: string | null | undefined): {
  success: boolean;
  code: string | null;
} {
  if (!responseFile) return { success: false, code: null };
  const success = /success\s*=\s*"(true|1)"/i.test(responseFile);
  const codeMatch = responseFile.match(/code\s*=\s*"([^"]*)"/i);
  return { success, code: codeMatch?.[1] ? codeMatch[1] : null };
}
