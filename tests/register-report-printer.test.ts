import { describe, expect, it } from 'vitest';
import { pickRegisterReportPrinter, printsByItself, REPORT_PRINTER_ALIVE_MS, type ReportPrinterRow } from '@/lib/register-report-printer';

const NOW = Date.parse('2026-10-25T14:10:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const lan = (id: string, polledMsAgo: number | null, extra: Partial<ReportPrinterRow> = {}): ReportPrinterRow => ({
  id,
  paper_width_mm: 80,
  maker: 'Star',
  connection_type: 'lan',
  last_polled_at: polledMsAgo === null ? null : ago(polledMsAgo),
  ...extra,
});
const bt = (id: string, polledMsAgo: number | null = null): ReportPrinterRow => ({
  id,
  paper_width_mm: 80,
  maker: 'Star',
  connection_type: 'bluetooth',
  last_polled_at: polledMsAgo === null ? null : ago(polledMsAgo),
});

describe('printsByItself', () => {
  it('Star の LAN（CloudPRNT）と EPSON（Server Direct Print）はプリンター自身で取りに来る', () => {
    expect(printsByItself(lan('a', 1000))).toBe(true);
    expect(printsByItself(lan('a', 1000, { maker: 'EPSON' }))).toBe(true);
    // メーカー名が空のままの古い行も CloudPRNT
    expect(printsByItself(lan('a', 1000, { maker: '' }))).toBe(true);
  });
  it('iPad の Bluetooth・USB と、iPad が LAN で送る機械（SII など）は自分では取りに来ない', () => {
    expect(printsByItself(bt('a'))).toBe(false);
    expect(printsByItself({ ...bt('a'), connection_type: 'usb' })).toBe(false);
    expect(printsByItself(lan('a', 1000, { maker: 'SII' }))).toBe(false);
  });
});

describe('pickRegisterReportPrinter', () => {
  it('レシートプリンターが無ければ null', () => {
    expect(pickRegisterReportPrinter([], null, NOW)).toBeNull();
  });

  it('選んだプリンターが LAN で動いていればそれ', () => {
    const rows = [lan('old', 2000), lan('mine', 1000)];
    expect(pickRegisterReportPrinter(rows, 'mine', NOW)).toEqual({ printer: rows[1], viaDevice: false });
  });

  it('選んでいなければ最初の 1 台（今まで通り）', () => {
    const rows = [lan('first', 1000), lan('second', 500)];
    expect(pickRegisterReportPrinter(rows, null, NOW)?.printer.id).toBe('first');
  });

  it('選んだのが iPad の Bluetooth なら、同じ店の LAN で動いているレシートプリンターへ（iPad がログアウトしても出る）', () => {
    // 御茶ノ水：同じ mC-Print3 を「レジ」（CloudPRNT）と「mC_Print3」（Bluetooth）の 2 行で登録
    const rows = [lan('regi', 1500), bt('bluetooth', 60_000)];
    expect(pickRegisterReportPrinter(rows, 'bluetooth', NOW)).toEqual({ printer: rows[0], viaDevice: false });
  });

  it('LAN の機械が何台もあれば、いちばん最近取りに来たもの', () => {
    const rows = [bt('bluetooth'), lan('a', 300_000), lan('b', 2_000)];
    expect(pickRegisterReportPrinter(rows, 'bluetooth', NOW)?.printer.id).toBe('b');
  });

  it('選んだ（最初の）LAN の行がもう取りに来ていなければ、動いている LAN の行へ（URL を入れ替えたあとの古い行）', () => {
    const rows = [lan('stale', 3 * 3600_000), lan('live', 1000)];
    expect(pickRegisterReportPrinter(rows, null, NOW)?.printer.id).toBe('live');
    expect(pickRegisterReportPrinter(rows, 'stale', NOW)?.printer.id).toBe('live');
  });

  it('動いている LAN の機械が無い Bluetooth だけの店は今まで通り Bluetooth（viaDevice＝ログアウトさせない）', () => {
    const rows = [bt('bluetooth')];
    expect(pickRegisterReportPrinter(rows, 'bluetooth', NOW)).toEqual({ printer: rows[0], viaDevice: true });
    // LAN の行があっても止まっていれば使わない
    const withDead = [lan('dead', REPORT_PRINTER_ALIVE_MS + 1000), bt('bluetooth')];
    expect(pickRegisterReportPrinter(withDead, 'bluetooth', NOW)).toEqual({ printer: withDead[1], viaDevice: true });
  });

  it('どれも取りに来た記録が無ければ今まで通り（選んだもの・最初の 1 台）', () => {
    const rows = [lan('a', null), lan('b', null)];
    expect(pickRegisterReportPrinter(rows, 'b', NOW)).toEqual({ printer: rows[1], viaDevice: false });
    expect(pickRegisterReportPrinter(rows, null, NOW)).toEqual({ printer: rows[0], viaDevice: false });
  });

  it('列が読めない古いスキーマ（maker・connection_type・last_polled_at 無し）は今まで通り', () => {
    const rows: ReportPrinterRow[] = [{ id: 'a', paper_width_mm: 80 }, { id: 'b', paper_width_mm: 58 }];
    expect(pickRegisterReportPrinter(rows, 'b', NOW)).toEqual({ printer: rows[1], viaDevice: false });
  });
});
