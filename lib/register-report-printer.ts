/**
 * レジ精算レシート（レジ締め・再印刷・精算情報）をどのレシートプリンターに出すか。
 *
 * 2026-10-25 23:13 お店「レジ締めの精算レシートが出てこなかったです」→ Ronnie「Yo chai fix gara」。
 * レジの iPad で選んだレシートプリンター（このiPadのプリンター）が Bluetooth・USB（iPad がつないで出す）だと、
 * 精算レシートはその行のキューに積まれ、iPad の印刷係が取りに来るまで出ない。ところがレジ端末はレジ締めのすぐあとに
 * ログアウトするので、印刷係が取りに来られず、精算レシートが出なかった（会計のレシートは会計の返事でそのまま
 * Bluetooth に送るので出ていた）。
 *
 * そこで：
 *   1. 選んだプリンター（無ければ最初の 1 台）が、プリンター自身で取りに来る機械（Star の CloudPRNT・EPSON の
 *      Server Direct Print）で、いま動いている（最近取りに来た）ならそれ。
 *   2. そうでなければ、プリンター自身で取りに来て、いま動いているレシートプリンター（いちばん最近取りに来たもの）。
 *      同じ機械を LAN（CloudPRNT）と Bluetooth の 2 行で登録している店は、LAN の行に出る＝iPad がログアウトしても出る。
 *   3. それも無ければ今まで通り（選んだプリンター・最初の 1 台）。iPad がつないで出すプリンターなら viaDevice=true
 *      （呼ぶ側は、印刷係が出し終わるまでログアウトさせない）。
 *
 * ここは純粋な関数だけ（テスト対象）。印刷のキュー・プリンターとのやりとり（lib/print-queue.ts・lib/printing/**）は触らない。
 */
import { printerDeliveryOf } from '@/lib/direct-print';

export interface ReportPrinterRow {
  id: string;
  paper_width_mm: number | null;
  maker?: string | null;
  connection_type?: string | null;
  last_polled_at?: string | null;
}

/** 「いま動いている」とみなす、最後に取りに来てからの時間（CloudPRNT は 1〜数秒ごとに取りに来る） */
export const REPORT_PRINTER_ALIVE_MS = 10 * 60_000;

/** プリンター自身が TENPO ONE に印刷を取りに来る機械か（iPad がいなくても出る） */
export function printsByItself(row: ReportPrinterRow): boolean {
  const d = printerDeliveryOf({ maker: row.maker ?? null, connection: row.connection_type ?? null });
  return d === 'cloudprnt' || d === 'sdp';
}

function polledAt(row: ReportPrinterRow): number | null {
  if (!row.last_polled_at) return null;
  const t = Date.parse(row.last_polled_at);
  return Number.isFinite(t) ? t : null;
}

function alive(row: ReportPrinterRow, nowMs: number): boolean {
  const t = polledAt(row);
  return t !== null && nowMs - t <= REPORT_PRINTER_ALIVE_MS;
}

export interface ReportPrinterChoice<T extends ReportPrinterRow> {
  printer: T;
  /** iPad（印刷係）がつないで出すプリンター。iPad がログアウトすると出ない */
  viaDevice: boolean;
}

/**
 * @param rows 店のレシートプリンター（有効なもの。作った順）
 * @param preferredId この端末で選んだプリンター（無ければ null）
 */
export function pickRegisterReportPrinter<T extends ReportPrinterRow>(
  rows: readonly T[],
  preferredId: string | null,
  nowMs: number
): ReportPrinterChoice<T> | null {
  if (rows.length === 0) return null;
  const base = rows.find((r) => r.id === preferredId) ?? rows[0];
  if (printsByItself(base) && alive(base, nowMs)) return { printer: base, viaDevice: false };

  const others = rows
    .filter((r) => r.id !== base.id && printsByItself(r) && alive(r, nowMs))
    .sort((a, b) => (polledAt(b) ?? 0) - (polledAt(a) ?? 0));
  if (others.length > 0) return { printer: others[0], viaDevice: false };

  return { printer: base, viaDevice: !printsByItself(base) };
}
