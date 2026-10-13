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

/**
 * iPad とつなぐレシートプリンターの種類（2026-10-13 Ronnie「ESC/POS・Star・RP-F10（Bluetooth / USB）を選べるように」）。
 *   star   … Star（mC-Print3 など）。StarPRNT を送る（StarXpand SDK）
 *   epson  … EPSON（TM-m30III など）。ESC/POS を送る（ePOS SDK）
 *   sii    … SII セイコー（RP-F10 など）。ESC/POS を送る（SII の SDK）
 *   escpos … そのほかの ESC/POS 対応プリンター（Bluetooth LE）
 */
export type BtMaker = 'star' | 'epson' | 'sii' | 'escpos';
export const BT_MAKERS: readonly BtMaker[] = ['star', 'epson', 'sii', 'escpos'];
export const BT_MAKER_LABEL: Record<BtMaker, string> = { star: 'Star', epson: 'EPSON', sii: 'SII（セイコー）', escpos: 'ESC/POS' };

/** 送るデータの形：Star は StarPRNT、それ以外は ESC/POS */
export function btFormatOf(maker: BtMaker): 'starprnt' | 'escpos' {
  return maker === 'star' ? 'starprnt' : 'escpos';
}

/** iPad と Bluetooth・USB でつないだレシートプリンター（TENPO ONE レジ アプリだけ） */
export interface BluetoothLink {
  /** TENPO ONE のプリンター（printer_configs.id） */
  printerId: string;
  /** アプリが見つけた機械（Star の identifier / EPSON の target / SII・BLE の識別子） */
  deviceId: string;
  deviceName: string;
  maker: BtMaker;
  /** つなぎ方 */
  via?: 'bluetooth' | 'usb';
}

export interface DirectPrintConfig {
  /** この端末から Wi-Fi で直接印刷するプリンター（printer_configs.id） */
  printerIds: string[];
  /** この端末と Bluetooth でつないだプリンター */
  bluetooth?: BluetoothLink[];
}

/** localStorage の値を読む（壊れていたら空） */
export function parseDirectPrintConfig(raw: string | null | undefined): DirectPrintConfig {
  if (!raw) return { printerIds: [], bluetooth: [] };
  try {
    const v = JSON.parse(raw) as { printerIds?: unknown; bluetooth?: unknown };
    const ids = Array.isArray(v?.printerIds) ? v.printerIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    const bt = Array.isArray(v?.bluetooth)
      ? (v.bluetooth as Partial<BluetoothLink>[]).filter(
          (x): x is BluetoothLink =>
            !!x &&
            typeof x.printerId === 'string' &&
            typeof x.deviceId === 'string' &&
            x.deviceId.length > 0 &&
            BT_MAKERS.includes(x.maker as BtMaker)
        )
      : [];
    const seen = new Set<string>();
    const links: BluetoothLink[] = bt
      .filter((x) => (seen.has(x.printerId) ? false : (seen.add(x.printerId), true)))
      .map((x) => ({
        printerId: x.printerId,
        deviceId: x.deviceId,
        deviceName: String(x.deviceName ?? ''),
        maker: x.maker,
        via: x.via === 'usb' ? 'usb' : 'bluetooth',
      }));
    return { printerIds: [...new Set(ids)].slice(0, 8), bluetooth: links.slice(0, 4) };
  } catch {
    return { printerIds: [], bluetooth: [] };
  }
}

/** プリンター設定のメーカー名から、iPad とつなぐときの種類。分からなければ ESC/POS（多くの機械が対応） */
export function bluetoothMakerOf(maker: string | null | undefined): BtMaker | null {
  const m = (maker ?? '').trim();
  if (/epson/i.test(m)) return 'epson';
  if (/star|スター/i.test(m)) return 'star';
  if (/sii|seiko|セイコー/i.test(m)) return 'sii';
  if (/esc\/?pos|その他|other/i.test(m) || m === '') return 'escpos';
  return 'escpos';
}

/** iPad から追加したプリンターに入れるメーカー名（管理画面の「メーカー」の選択肢と同じ言い方） */
export const BT_MAKER_SETTING: Record<BtMaker, string> = { star: 'Star', epson: 'EPSON', sii: 'SII', escpos: 'その他' };

/**
 * iPad で見つけた機械の名前から、プリンターの名前を作る（2026-10-13 Ronnie「iPad でプリンターの設定。レシートは Bluetooth」）。
 * 見えない文字を消して 60 文字まで。空なら「EPSON レシート」のように。
 */
export function deviceReceiptPrinterName(name: string | null | undefined, maker: BtMaker): string {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return clean || `${BT_MAKER_SETTING[maker] === 'その他' ? 'ESC/POS' : BT_MAKER_SETTING[maker]} レシート`;
}

/** メーカー名が EPSON か */
export function isEpsonMaker(maker: string | null | undefined): boolean {
  return /epson/i.test(maker ?? '');
}
