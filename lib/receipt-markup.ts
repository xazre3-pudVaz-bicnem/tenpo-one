/**
 * ReceiptData → Star Document Markup（text/vnd.star.markup）変換（純関数・テスト対象）。
 * Star mC-Print3 等の CloudPRNT 対応機がこのMarkupを解釈して感熱レシートを印字する。
 * 使用するMarkup命令は公式確認済みのものに限定する:
 *   [align: middle|left|right] / [magnify: width N; height N] / [feed] / [cut: feed; partial]
 * キャッシュドロアはMarkupに機種依存があるため drawerKickMarkup() で別ジョブとして扱う。
 */
import type { ReceiptData } from './receipts';

/** 感熱ロール幅ごとの1行あたり半角文字数（font A・mC-Print3目安）。全角は2文字ぶんで数える。 */
const COLS: Record<number, number> = { 58: 32, 80: 48 };

const yen = (n: number): string => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 表示幅（CJK全角=2, その他=1）。二段組の桁揃えに使う。 */
function dispWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // CJK統合漢字/かな/全角記号/全角英数などを全角とみなす
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

/** 左右2段組。1行に収まらなければ右側を次行の右寄せにする。 */
function twoCol(left: string, right: string, width: number): string {
  const gap = width - dispWidth(left) - dispWidth(right);
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  // 収まらない場合は右を次行へ
  const pad = Math.max(0, width - dispWidth(right));
  return `${left}\n${' '.repeat(pad)}${right}`;
}

/** Markup構文で意味を持つ文字を無害化（角括弧・バックスラッシュ）。 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export interface ReceiptMarkupOptions {
  paperWidth?: 58 | 80;
}

export function receiptToStarMarkup(receipt: ReceiptData, options: ReceiptMarkupOptions = {}): string {
  const width = COLS[options.paperWidth ?? 80] ?? 48;
  const rule = '-'.repeat(width);
  const L: string[] = [];
  const line = (s = '') => L.push(esc(s));
  const raw = (s: string) => L.push(s); // Markup命令はエスケープしない

  raw('[align: middle]');
  if (receipt.isReissue) line('※ 再発行');
  if (receipt.isRefundReceipt) line('※ 返金レシート');

  raw('[magnify: width 2; height 2]');
  line(receipt.storeName);
  raw('[magnify: width 1; height 1]');
  if (receipt.storeAddress) line(receipt.storeAddress);
  if (receipt.storePhone) line(`TEL ${receipt.storePhone}`);
  raw('[align: left]');
  if (receipt.registrationNumber) line(`登録番号 ${receipt.registrationNumber}`);
  line(rule);
  line(`発行 ${receipt.issuedAt}`);
  line(twoCol(`No.${receipt.orderNo}`, [receipt.registerName, receipt.staffName].filter(Boolean).join(' '), width));
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
  raw('[magnify: width 2; height 1]');
  line(twoCol('合計', yen(receipt.total), Math.floor(width / 2)));
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

/**
 * キャッシュドロアを開くMarkup。機種/ファームで方言が異なり得るため、
 * コマンド文字列は printer_configs.drawer_command で調整可能にしている（既定 '[drawer: 1]'）。
 */
export function drawerKickMarkup(command: string): string {
  const cmd = (command || '[drawer: 1]').trim();
  return `${cmd}\n`;
}

/** 接続確認用のテスト印字Markup。実注文を使わずにプリンタの疎通と文字化けを確認できる。 */
export function testPrintMarkup(opts: { storeName: string; paperWidth?: 58 | 80; issuedAt: string }): string {
  const width = COLS[opts.paperWidth ?? 80] ?? 48;
  const rule = '-'.repeat(width);
  return [
    '[align: middle]',
    '[magnify: width 2; height 2]',
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
    '[align: middle]',
    'このレシートが正しく印字されれば接続成功です',
    '[feed]',
    '[cut: feed; partial]',
    '',
  ].join('\n');
}
