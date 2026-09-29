/**
 * stera terminal（三井住友カード）との連携（2026-09-29 Ronnie「会計で stera を押したら、金額が端末へ行って、
 * 決済されて、会計になって、ドロアまで開くように」）。
 *
 * しくみ（LAN は使わない。CloudPRNT と同じくクラウド中継）:
 *   1. レジ（iPad）で「stera で決済」→ stera_payment_requests に1行（金額・支払種別）
 *   2. stera 端末の「TENPO ONE 連携」アプリ（android/stera-link）が /api/stera/<リンクコード> を1〜2秒ごとに見て受け取り、
 *      端末の決済アプリを Intent で呼ぶ（stera developers「stera標準搭載の決済アプリと連携する」）
 *   3. 決済の結果をアプリが /api/stera/<リンクコード> に POST → レジが確認して会計を確定（checkout）→ ドロアを開く
 *
 * ここはサーバー・画面・テストで共通の決まりごと（DB やネットワークに触らない）。
 */

/** 決済アプリの Intent（公開仕様） */
export const STERA_PAYMENT_COMPONENT = 'com.panasonic.smartpayment.android.salesmenu/.MainActivity';

/** レジで選ぶ支払種別（Intent の PaymentType） */
export const STERA_PAYMENT_TYPES = [
  { code: '01', method: 'credit', label: 'クレジット', en: 'Credit card' },
  { code: '02-02', method: 'emoney', label: '交通系IC', en: 'Transit IC' },
  { code: '02-01', method: 'emoney', label: 'iD', en: 'iD' },
  { code: '02-06', method: 'emoney', label: 'QUICPay', en: 'QUICPay' },
  { code: '02-03', method: 'emoney', label: '楽天Edy', en: 'Rakuten Edy' },
  { code: '02-04', method: 'emoney', label: 'WAON', en: 'WAON' },
  { code: '02-05', method: 'emoney', label: 'nanaco', en: 'nanaco' },
  { code: '02-07', method: 'emoney', label: 'PiTaPa', en: 'PiTaPa' },
  { code: '03', method: 'qr', label: 'QRコード決済', en: 'QR payment' },
] as const;

export type SteraPaymentTypeCode = (typeof STERA_PAYMENT_TYPES)[number]['code'];
export type SteraMethod = 'credit' | 'emoney' | 'qr';

export function isSteraPaymentType(value: unknown): value is SteraPaymentTypeCode {
  return typeof value === 'string' && STERA_PAYMENT_TYPES.some((t) => t.code === value);
}

export function steraPaymentTypeLabel(code: string): string {
  return STERA_PAYMENT_TYPES.find((t) => t.code === code)?.label ?? code;
}

/** 返ってきた CreditCardBrand（公開仕様）→ 支払方法の内訳の名前（lib/checkout-presets.ts と同じ書き方） */
const CREDIT_BRANDS: Record<string, string> = {
  '01': 'VISA',
  '02': 'Mastercard',
  '03': 'JCB',
  '04': 'AMEX',
  '05': 'Diners',
  '06': '銀聯',
};
/** EMoneyType */
const EMONEY_TYPES: Record<string, string> = {
  '01': 'iD',
  '02': '交通系IC',
  '03': '楽天Edy',
  '04': 'WAON',
  '05': 'nanaco',
  '06': 'QUICPay',
  '07': 'PiTaPa',
};
/** QRPayType */
const QR_PAY_TYPES: Record<string, string> = {
  '11': '楽天ペイ',
  '12': 'LINE Pay',
  '13': 'PayPay',
  '14': 'd払い',
  '15': 'au PAY',
  '16': 'メルペイ',
  '19': '銀行Pay',
  '21': 'WeChat Pay',
  '22': 'Alipay',
  '23': '銀聯',
  '35': 'BankPay',
  '37': 'AEON Pay',
  '38': 'アトカラ',
};

/** 端末から受け取ってよい結果の項目（これ以外は捨てる。カード番号はマスクされたものだけ） */
const RESULT_KEYS = [
  'PaymentType',
  'ErrorCode',
  'SlipNumber',
  'TransactionType',
  'Amount',
  'Tax',
  'CreditCardBrand',
  'CreditCardMaskedPAN',
  'CurrencyCode',
  'EMoneyNumber',
  'QRPayType',
  'EMoneyType',
] as const;

export type SteraOutcome = 'SUCCESS' | 'FAIL' | 'CANCEL';

export interface SteraResultInput {
  /** アプリが決めた結果（SUCCESS / FAIL / CANCEL）。onActivityResult の結果と ErrorCode から */
  outcome: string;
  /** onActivityResult の resultCode（そのまま。調べるとき用） */
  resultCode?: number | string | null;
  /** 決済アプリが返した extras（文字列） */
  extras?: Record<string, unknown> | null;
}

export interface SteraResult {
  status: 'succeeded' | 'failed' | 'canceled';
  method: SteraMethod | null;
  /** 支払方法の内訳（VISA・PayPay・交通系IC など）。分からなければ null */
  brand: string | null;
  amount: number | null;
  /** 保存する結果（受け取ってよい項目だけ・カード番号は念のためもう一度マスク） */
  saved: Record<string, string | number | null>;
}

/** カード番号らしいものは末尾4桁以外を * にする（決済アプリはマスク済みで返すが念のため） */
export function maskPan(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 12) return value; // すでにマスク済み（* を含む）か短いものはそのまま
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 64) : null;
}

/** PaymentType（返り値は "01"/"02"/"03"、依頼は "02-01" など）→ 支払方法 */
export function methodOfPaymentType(code: string | null | undefined): SteraMethod | null {
  if (!code) return null;
  if (code.startsWith('01')) return 'credit';
  if (code.startsWith('02')) return 'emoney';
  if (code.startsWith('03')) return 'qr';
  return null;
}

/**
 * 端末から届いた結果を読む。成功は outcome=SUCCESS かつ ErrorCode が空のときだけ。
 * requestedType は依頼した支払種別（返り値に PaymentType が無いときに使う）。
 */
export function interpretSteraResult(input: SteraResultInput, requestedType: string): SteraResult {
  const extras = input.extras ?? {};
  const saved: Record<string, string | number | null> = {};
  for (const k of RESULT_KEYS) {
    const v = str(extras[k]);
    if (v != null) saved[k] = k === 'CreditCardMaskedPAN' || k === 'EMoneyNumber' ? maskPan(v) : v;
  }
  const outcome = String(input.outcome ?? '').toUpperCase();
  saved.outcome = outcome || null;
  if (input.resultCode != null) saved.resultCode = typeof input.resultCode === 'number' ? input.resultCode : String(input.resultCode).slice(0, 16);

  const errorCode = (saved.ErrorCode as string | undefined) ?? '';
  const status: SteraResult['status'] =
    outcome === 'SUCCESS' && !errorCode ? 'succeeded' : outcome === 'CANCEL' ? 'canceled' : 'failed';

  const typeCode = (saved.PaymentType as string | undefined) ?? requestedType;
  const method = methodOfPaymentType(typeCode) ?? methodOfPaymentType(requestedType);
  let brand: string | null = null;
  if (method === 'credit') brand = CREDIT_BRANDS[(saved.CreditCardBrand as string) ?? ''] ?? null;
  if (method === 'emoney') {
    brand =
      EMONEY_TYPES[(saved.EMoneyType as string) ?? ''] ??
      STERA_PAYMENT_TYPES.find((t) => t.code === requestedType && t.method === 'emoney')?.label ??
      null;
  }
  if (method === 'qr') brand = QR_PAY_TYPES[(saved.QRPayType as string) ?? ''] ?? null;

  const amountRaw = saved.Amount != null ? Number(saved.Amount) : NaN;
  return { status, method, brand, amount: Number.isFinite(amountRaw) ? amountRaw : null, saved };
}

/** 伝票番号（SlipNumber "00001"〜"99999"）。注文番号の下5桁（0 は 00001） */
export function steraSlipNumber(orderNo: number | string | null | undefined): string {
  const n = Math.abs(Math.trunc(Number(orderNo) || 0)) % 100000;
  return String(n === 0 ? 1 : n).padStart(5, '0');
}

/** リンクコード（端末のアプリに1回だけ入れる）。紛らわしい字（0/O・1/I）を使わない12文字 */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newLinkCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
  return out;
}

/** 表示用（4文字ずつ区切る） */
export function formatLinkCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** 入力・URL から受け取ったコードをそろえる（大文字・区切りを取る）。形が違えば null */
export function normalizeLinkCode(input: string | null | undefined): string | null {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length !== 12) return null;
  for (const ch of s) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** 端末が受け取らないまま待つ時間（過ぎたら expired） */
export const STERA_QUEUE_TTL_MS = 2 * 60 * 1000;
/** 端末が「つながっている」とみなす最後のポーリングからの時間 */
export const STERA_ONLINE_MS = 30 * 1000;

export function isSteraOnline(lastSeenAt: string | null | undefined, now: number): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) && now - t <= STERA_ONLINE_MS;
}
