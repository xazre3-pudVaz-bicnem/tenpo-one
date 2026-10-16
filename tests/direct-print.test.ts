import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  eposErrorLabel,
  eposServiceUrl,
  eposSoapEnvelope,
  isEpsonMaker,
  isLocalPrinterHost,
  parseDirectPrintConfig,
  parseEposResponse,
  printerCertUrl,
} from '@/lib/direct-print';
import { drawerKickEpos } from '@/lib/epos-print';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** 2026-10-13 Ronnie「Airレジのように、プリンターを選んで、すぐ・速く印刷。EPSON を Wi-Fi で。今のものは壊さない」 */
describe('Wi-Fi で直接印刷（EPSON ePOS-Print）', () => {
  it('送り先はお店の中のアドレスだけ（インターネットの先には送らない）', () => {
    for (const ok of ['192.168.0.50', '10.0.1.2', '172.16.5.9', '172.31.255.1', 'tm-m30iii.local']) expect(isLocalPrinterHost(ok)).toBe(true);
    for (const ng of ['8.8.8.8', '172.32.0.1', '192.169.0.1', 'example.com', '192.168.0.256', '', null, 'http://192.168.0.5']) {
      expect(isLocalPrinterHost(ng as string | null)).toBe(false);
    }
  });

  it('https の ePOS-Print（画面が https なので http には送れない）', () => {
    expect(eposServiceUrl('192.168.0.50')).toBe('https://192.168.0.50/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000');
    expect(eposServiceUrl(' 192.168.0.50 ', 500)).toContain('timeout=1000');
    expect(printerCertUrl('192.168.0.50')).toBe('https://192.168.0.50/');
  });

  it('今の EPSON 用の印刷データ（epos-print）をそのまま SOAP に包む', () => {
    const xml = drawerKickEpos(null);
    const soap = eposSoapEnvelope(xml);
    expect(soap.startsWith('<?xml version="1.0" encoding="utf-8"?><s:Envelope')).toBe(true);
    expect(soap).toContain(`<s:Body>${xml}</s:Body>`);
    expect(eposSoapEnvelope('<text>a</text>')).toContain('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><text>a</text></epos-print>');
  });

  it('プリンターの返事を読む', () => {
    const ok = '<?xml version="1.0"?><s:Envelope><s:Body><response success="true" code="" status="251658262" battery="0" xmlns="x"/></s:Body></s:Envelope>';
    expect(parseEposResponse(ok)).toEqual({ success: true, code: null, status: 251658262 });
    const ng = '<response success="false" code="EPTR_REC_EMPTY" status="1"/>';
    expect(parseEposResponse(ng)).toEqual({ success: false, code: 'EPTR_REC_EMPTY', status: 1 });
    expect(parseEposResponse('garbage').success).toBe(false);
    expect(eposErrorLabel('EPTR_REC_EMPTY')).toBe('レシートの紙がありません');
    expect(eposErrorLabel('EPTR_COVER_OPEN')).toContain('カバー');
  });

  it('この端末の設定（壊れていたら空＝何もしない）', () => {
    expect(parseDirectPrintConfig(null)).toEqual({ printerIds: [], bluetooth: [], lan: [] });
    expect(parseDirectPrintConfig('{bad')).toEqual({ printerIds: [], bluetooth: [], lan: [] });
    expect(parseDirectPrintConfig(JSON.stringify({ printerIds: ['a', 'a', 3, 'b'] }))).toEqual({ printerIds: ['a', 'b'], bluetooth: [], lan: [] });
    expect(isEpsonMaker('EPSON')).toBe(true);
    expect(isEpsonMaker('Star')).toBe(false);
  });
});

describe('今の印刷は壊さない', () => {
  it('本番の CSP で iPad からプリンター（https://192.168.…）へ送れる', () => {
    expect(read('next.config.ts')).toContain("connectSrc.push('https:');");
  });

  it('ON にしていない端末では何もしない（設定が空ならループを止める）', () => {
    const agent = read('components/printing/direct-print-agent.tsx');
    expect(agent).toContain('if (config.printerIds.length === 0 && links.length === 0 && agentLinks.length === 0 && lanIds.length === 0) return;');
    expect(read('app/app/layout.tsx')).toContain('<DirectPrintAgent />');
  });

  it('同じ伝票が2枚出ない：まだ queued のときだけ claimed にする', () => {
    const q = read('lib/print-queue.ts');
    expect(q).toContain(".eq('id', job.id)\n    .eq('status', 'queued')\n    .select('id');");
  });

  it('つながらないときはキューに戻す（プリンター自身の印刷に任せる）。返事が無いときは戻さない（2枚防止）', () => {
    const route = read('app/api/print/direct/route.ts');
    expect(route).toContain("body.result === 'unreachable'");
    expect(route).toContain('await releaseJob(admin, printer.id, body.jobId);');
    expect(route).toContain('isEpsonMaker(row.maker)');
    expect(route).toContain('isLocalPrinterHost(host)');
    expect(route).toContain('row.organization_id !== ctx.organizationId');
    const agent = read('components/printing/direct-print-agent.tsx');
    expect(agent).toContain("await done(job, 'failed', 'direct: timeout');");
  });

  it('この iPad で選んだプリンター：選んでいなければ今まで通り（店の既定・フロア）', () => {
    const actions = read('app/app/pos/print-actions.ts');
    expect(actions).toContain('const picked = preferred ?? (floor ? pickPrinterForFloor(rows, floor.floorId) : pickDefaultPrinter(rows));');
    const report = read('lib/register-report-loader.ts');
    expect(report).toContain('rows.find((r) => r.id === preferredId) ?? rows[0] ?? null');
    const set = read('app/app/pos/device-printer-actions.ts');
    expect(set).toContain("printer.usage !== 'receipt' && printer.bill_slips !== true");
  });
});
