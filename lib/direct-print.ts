/**
 * Wi-Fi で iPad から EPSON プリンターへ直接印刷する（2026-10-13 Ronnie「Airレジのように、プリンターを選んで
 * すぐ・速く印刷。EPSON を Wi-Fi で。今のものは壊さない」）。
 *
 * しくみ：
 *   - 今まで通り、印刷はまず TENPO ONE のキュー（print_jobs）に積む（レジ・ハンディ・お客様QR・厨房、どこからでも）。
 *   - 「Wi-Fi で直接印刷」を ON にした iPad（このブラウザ）が、そのプリンター宛ての印刷を1秒ごとに受け取り、
 *     お店の Wi-Fi でプリンター（EPSON の ePOS-Print）へ直接送る。プリンターがインターネットに問い合わせるのを待たない。
 *   - iPad が閉じている・つながらないときは、今まで通りプリンター自身の Server Direct Print が印刷する（壊さない）。
 *
 * ここは純粋な関数だけ（ブラウザ・サーバー両方から使う・テスト対象）。
 */

/** この端末（ブラウザ）で使うレシートプリンター（cookie。サーバーの印刷が読む） */
export const DEVICE_PRINTER_COOKIE = 'tenpo_device_printer';

/** この端末で「Wi-Fi で直接印刷」するプリンター（localStorage。この端末だけ） */
export const DIRECT_PRINT_STORAGE_KEY = 'tenpo-direct-print';

/** 印刷を受け取りに行く間隔（画面を開いているとき） */
export const DIRECT_POLL_MS = 1000;
/** プリンターにつながらなかったときに、次に試すまで待つ時間（その間はプリンター自身の印刷に任せる） */
export const DIRECT_BACKOFF_MS = 15_000;
/** プリンターの返事を待つ上限 */
export const DIRECT_TIMEOUT_MS = 10_000;

const EPOS_PRINT_NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

/** お店の中のアドレスか（192.168.x.x・10.x.x.x・172.16〜31.x.x、または ○○.local） */
export function isLocalPrinterHost(host: string | null | undefined): boolean {
  const h = (host ?? '').trim().toLowerCase();
  if (!h) return false;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** EPSON の ePOS-Print（プリンター内蔵）の送り先。https（TENPO ONE の画面が https なので http には送れない） */
export function eposServiceUrl(host: string, timeoutMs = DIRECT_TIMEOUT_MS): string {
  return `https://${host.trim()}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=${Math.max(1000, Math.round(timeoutMs))}`;
}

/** 証明書を許可するために一度開くページ（プリンターの設定画面） */
export function printerCertUrl(host: string): string {
  return `https://${host.trim()}/`;
}

/** ePOS-Print XML（<epos-print …>…</epos-print>）を ePOS-Print の SOAP 本文に包む */
export function eposSoapEnvelope(eposXml: string): string {
  const body = eposXml.includes('<epos-print') ? eposXml : `<epos-print xmlns="${EPOS_PRINT_NS}">${eposXml}</epos-print>`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<s:Body>${body}</s:Body>` +
    '</s:Envelope>'
  );
}

/** ePOS-Print に送るときのヘッダー（EPSON の SDK と同じ） */
export const EPOS_REQUEST_HEADERS: Record<string, string> = {
  'Content-Type': 'text/xml; charset=utf-8',
  'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
  SOAPAction: '""',
};

export interface EposResult {
  success: boolean;
  code: string | null;
  status: number | null;
}

/** プリンターの返事（<response success="true" code="" status="…"/>）を読む */
export function parseEposResponse(text: string): EposResult {
  const tag = /<response\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
  const success = /^(true|1)$/i.test(attr('success') ?? '');
  const code = (attr('code') ?? '').trim() || null;
  const statusRaw = attr('status');
  const status = statusRaw != null && /^\d+$/.test(statusRaw) ? Number(statusRaw) : null;
  return { success, code, status };
}

/** プリンターが返したエラーを、お店の人に分かる言葉に */
export function eposErrorLabel(code: string | null): string {
  switch (code) {
    case 'EPTR_COVER_OPEN':
      return 'プリンターのカバーが開いています';
    case 'EPTR_REC_EMPTY':
      return 'レシートの紙がありません';
    case 'EPTR_AUTOMATICAL':
    case 'EPTR_MECHANICAL':
    case 'EPTR_UNRECOVERABLE':
      return 'プリンターのエラーです。電源を入れ直してください';
    case 'DeviceNotFound':
    case 'EX_TIMEOUT':
      return 'プリンターが応答しません';
    case 'SchemaError':
    case 'ParameterError':
      return '印刷データをプリンターが読めませんでした';
    default:
      return code ? `プリンターのエラー（${code}）` : 'プリンターのエラー';
  }
}

export interface DirectPrintConfig {
  /** この端末から Wi-Fi で直接印刷するプリンター（printer_configs.id） */
  printerIds: string[];
}

/** localStorage の値を読む（壊れていたら空） */
export function parseDirectPrintConfig(raw: string | null | undefined): DirectPrintConfig {
  if (!raw) return { printerIds: [] };
  try {
    const v = JSON.parse(raw) as { printerIds?: unknown };
    const ids = Array.isArray(v?.printerIds) ? v.printerIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    return { printerIds: [...new Set(ids)].slice(0, 8) };
  } catch {
    return { printerIds: [] };
  }
}

/** メーカー名が EPSON か */
export function isEpsonMaker(maker: string | null | undefined): boolean {
  return /epson/i.test(maker ?? '');
}
