/**
 * ReceiptData → StarPRNT ラスタ制御コマンド（application/vnd.star.starprnt）変換。
 *
 * Star Document Markup（lib/receipt-markup.ts）は mC-Print3 でもファームによっては非対応で、
 * CloudPRNT が `510 Incompatible Media Type` を返す。StarPRNT はより古いファームでも通るため、
 * CloudPRNT の mediaTypes に両方を提示し、プリンタ自身に選ばせる（route.ts 参照）。
 *
 * 桁揃えは receipt-layout.ts を Markup 版と共有するため、同一注文なら両形式で同じ見た目になる。
 */
import iconv from 'iconv-lite';
import type { ReceiptData } from './receipts';
import { colsFor, twoCol, yen, type PaperWidth } from './receipt-layout';

const ESC = 0x1b;
const GS = 0x1d;

/**
 * StarPRNT 制御コマンド。
 * mC-Print3 実機（FW確認: docs/pilots/fogo-cloudprnt-setup.md）で印字確認したもののみを置く。
 */
const CMD = {
  /** プリンタ初期化。先頭で必ず送る（前ジョブの装飾状態を持ち越さない）。 */
  init: [ESC, 0x40],
  alignLeft: [ESC, GS, 0x61, 0x00],
  alignCenter: [ESC, GS, 0x61, 0x01],
  /** 文字拡大 ESC i n1(縦) n2(横)。0=等倍。 */
  magnify: (w: number, h: number) => [ESC, 0x69, h, w],
  emphasizeOn: [ESC, 0x45],
  emphasizeOff: [ESC, 0x46],
  /** フィードして部分カット。 */
  cut: [ESC, 0x64, 0x03],
  /** ドロアキック。1番=BEL, 2番=SUB（機種で割り当てが異なるため設定で切替可能にする）。 */
  drawer1: [0x07],
  drawer2: [0x1a],
} as const;

/**
 * 本文の文字エンコード。
 * mC-Print3 実機（FOGO新宿）で検証したところ、StarPRNT の生モードでは UTF-8 は解釈されず
 * 英数字以外が化ける。CP932(Shift-JIS) で送ると正しく印字される。
 * 新しいファームで UTF-8 を解釈する個体のために切替を残す。
 */
export type TextEncoding = 'cp932' | 'utf8';

/**
 * 通貨記号の出し方。U+00A5(¥) は CP932 に直接変換できないため置換が必要。
 * 実機検証では 0x5C（バックスラッシュ位置）が ￥ として印字され、かつ半角1桁のままなので
 * 桁揃え（dispWidth が ¥ を1桁と数える）が崩れない。全角￥は2桁を占めるため既定にしない。
 */
export type CurrencyStyle = 'yen-sign' | 'backslash' | 'fullwidth';

export interface StarPrntOptions {
  paperWidth?: PaperWidth;
  currency?: CurrencyStyle;
  encoding?: TextEncoding;
}

const DEFAULT_CURRENCY: CurrencyStyle = 'backslash';
const DEFAULT_ENCODING: TextEncoding = 'cp932';

/** yen() が生成する ¥ を、実機の文字セットに合わせて置換する。 */
function applyCurrency(s: string, style: CurrencyStyle): string {
  // CP932系の文字セットでは ¥ は 0x5C（バックスラッシュ位置）に割り当てられる
  if (style === 'backslash') return s.replace(/¥/g, String.fromCharCode(0x5c));
  if (style === 'fullwidth') return s.replace(/¥/g, '￥');
  return s;
}

/** 行バッファ。テキストは指定エンコードへ、制御コマンドはバイト列としてそのまま積む。 */
class StarBuffer {
  private parts: Buffer[] = [];
  constructor(
    private currency: CurrencyStyle,
    private encoding: TextEncoding
  ) {}

  cmd(bytes: readonly number[]): this {
    this.parts.push(Buffer.from(bytes));
    return this;
  }
  /** 1行ぶんのテキスト（改行付き）。 */
  line(s = ''): this {
    const text = applyCurrency(s, this.currency) + '\n';
    this.parts.push(
      this.encoding === 'utf8' ? Buffer.from(text, 'utf8') : iconv.encode(text, 'Shift_JIS')
    );
    return this;
  }
  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

export function receiptToStarPrnt(receipt: ReceiptData, options: StarPrntOptions = {}): Buffer {
  const width = colsFor(options.paperWidth);
  const rule = '-'.repeat(width);
  const b = new StarBuffer(options.currency ?? DEFAULT_CURRENCY, options.encoding ?? DEFAULT_ENCODING);

  b.cmd(CMD.init).cmd(CMD.alignCenter);
  if (receipt.isReissue) b.line('※ 再発行');
  if (receipt.isRefundReceipt) b.line('※ 返金レシート');

  b.cmd(CMD.magnify(1, 1)).line(receipt.storeName).cmd(CMD.magnify(0, 0));
  if (receipt.storeAddress) b.line(receipt.storeAddress);
  if (receipt.storePhone) b.line(`TEL ${receipt.storePhone}`);
  b.cmd(CMD.alignLeft);
  if (receipt.registrationNumber) b.line(`登録番号 ${receipt.registrationNumber}`);
  b.line(rule);
  b.line(`発行 ${receipt.issuedAt}`);
  b.line(twoCol(`No.${receipt.orderNo}`, [receipt.registerName, receipt.staffName].filter(Boolean).join(' '), width));
  b.line(rule);

  // 明細
  for (const it of receipt.lines) {
    if (it.cancelled) continue;
    b.line(it.name);
    b.line(twoCol(`  ${it.quantity} x ${yen(it.unitPrice)}`, yen(it.lineTotal), width));
    for (const m of it.modifiers) {
      b.line(twoCol(`   + ${m.name}`, m.price ? yen(m.price) : '', width));
    }
  }
  b.line(rule);

  // 金額
  b.line(twoCol('小計', yen(receipt.subtotal), width));
  for (const t of receipt.taxRows) {
    b.line(twoCol(`  (税${t.rate}%対象 ${yen(t.taxable)})`, `税${yen(t.tax)}`, width));
  }
  if (receipt.serviceCharge > 0) b.line(twoCol('サービス料', yen(receipt.serviceCharge), width));
  if (receipt.discount > 0) {
    b.line(twoCol(`値引${receipt.couponCode ? ` (${receipt.couponCode})` : ''}`, `-${yen(receipt.discount)}`, width));
  }
  b.cmd(CMD.emphasizeOn).line(twoCol('合計', yen(receipt.total), width)).cmd(CMD.emphasizeOff);
  b.line(rule);

  // 支払
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

  b.cmd(CMD.alignCenter);
  if (receipt.footerMessage) {
    for (const fl of receipt.footerMessage.split('\n')) b.line(fl);
  }
  b.line(`照会番号 ${receipt.qrContent}`);
  b.line().line();
  b.cmd(CMD.cut);

  return b.toBuffer();
}

/**
 * キャッシュドロア開放。設定値は Markup 記法（既定 '[drawer: 1]'）で保持しているため、
 * 末尾の番号だけを読み取って StarPRNT のドロア命令へ写像する。設定UIを二重に持たせない。
 */
export function drawerKickStarPrnt(command: string): Buffer {
  const n = /2/.test(command ?? '') ? 2 : 1;
  return Buffer.from(n === 2 ? CMD.drawer2 : CMD.drawer1);
}

/** 接続確認用のテスト印字。Markup版 testPrintMarkup() と同じ内容を StarPRNT で出す。 */
export function testPrintStarPrnt(opts: {
  storeName: string;
  paperWidth?: PaperWidth;
  issuedAt: string;
  currency?: CurrencyStyle;
  encoding?: TextEncoding;
}): Buffer {
  const width = colsFor(opts.paperWidth);
  const rule = '-'.repeat(width);
  const b = new StarBuffer(opts.currency ?? DEFAULT_CURRENCY, opts.encoding ?? DEFAULT_ENCODING);

  b.cmd(CMD.init).cmd(CMD.alignCenter);
  b.cmd(CMD.magnify(1, 1)).line(opts.storeName || 'TENPO ONE').cmd(CMD.magnify(0, 0));
  b.line('CloudPRNT テスト印刷 (StarPRNT)');
  b.cmd(CMD.alignLeft);
  b.line(rule);
  b.line(twoCol('接続', 'OK', width));
  b.line(twoCol('形式', 'application/vnd.star.starprnt', width));
  b.line(twoCol('用紙幅', `${opts.paperWidth ?? 80}mm`, width));
  b.line(twoCol('発行', opts.issuedAt, width));
  b.line(`日本語テスト：シュラスコ ${yen(1234)}`);
  b.line(rule);
  b.cmd(CMD.alignCenter).line('このレシートが正しく印字されれば接続成功です');
  b.line().line();
  b.cmd(CMD.cut);

  return b.toBuffer();
}
