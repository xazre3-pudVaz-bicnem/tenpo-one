import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_DOTS,
  gridOf,
  SII_AGENT_DEVICE_ID,
  cellsOf,
  imagePdf,
  jpegInfo,
  layoutRaster,
  parseEposForRaster,
  printableDots,
  siiAgentUrl,
  toBase64,
} from '@/lib/sii-url-print';
import { drawerKickEpos, testPrintEpos } from '@/lib/epos-print';
import { parseDirectPrintConfig } from '@/lib/direct-print';
import { AGENT_PRINTER_MODELS, printerModelById } from '@/lib/printer-models';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** いちばん小さい JPEG（SOI・SOF0（幅 576・高さ 40・3色）・EOI だけ。中身は読まない） */
function fakeJpeg(width: number, height: number, components = 3): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 8 + components * 3, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let i = 0; i < components; i++) sof.push(i + 1, 0x11, 0x00);
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, ...sof, 0xff, 0xd9]);
}

/** 2026-10-14 Ronnie「MEAT CROWN 新横浜。Airレジの SII RP-F10 を Bluetooth で。アプリはまだ無いので Safari でも」 */
describe('SII URL Print Agent（Safari から SII の Bluetooth プリンター）', () => {
  it('ePOS-Print XML を行に分ける（揃え・倍率・太字は「ここから先」、<cut> で紙を分ける、<pulse> はドロア）', () => {
    const xml =
      '<epos-print xmlns="x"><text lang="ja"/><text align="center"/><text width="2" height="2"/><text>店名&#10;</text>' +
      '<text width="1" height="1"/><text align="left"/><text>小計    ¥1,000&#10;&#10;</text><feed line="3"/><cut type="feed"/>' +
      '<text em="true"/><text>領収書&#10;</text><feed line="3"/><cut type="feed"/><pulse drawer="drawer_1" time="pulse_100"/></epos-print>';
    const doc = parseEposForRaster(xml);
    expect(doc.drawer).toBe(true);
    expect(doc.empty).toBe(false);
    expect(doc.pages).toHaveLength(2);
    const [first, second] = doc.pages;
    expect(first[0]).toEqual({ kind: 'text', align: 'center', segments: [{ text: '店名', w: 2, h: 2, em: false }] });
    expect(first[1]).toEqual({ kind: 'text', align: 'left', segments: [{ text: '小計    ¥1,000', w: 1, h: 1, em: false }] });
    expect(first[2]).toEqual({ kind: 'text', align: 'left', segments: [] }); // 空の行
    expect(first).toHaveLength(3); // 紙の終わりの送りは SII のアプリに任せる
    expect(second[0]).toMatchObject({ kind: 'text', segments: [{ text: '領収書', em: true }] });
  });

  it('ドロアだけの印刷は「文字なし」', () => {
    const doc = parseEposForRaster(drawerKickEpos(null));
    expect(doc.drawer).toBe(true);
    expect(doc.empty).toBe(true);
  });

  it('試し印刷のデータも読める', () => {
    const doc = parseEposForRaster(testPrintEpos({ storeName: 'MEAT CROWN 新横浜', paperWidth: 80, issuedAt: '2026/10/14 18:00' }));
    expect(doc.empty).toBe(false);
    expect(doc.pages[0].some((l) => l.kind === 'text' && l.segments.some((s) => s.text.includes('MEAT CROWN')))).toBe(true);
  });

  it('紙の上の並び：80mm＝576ドットを EPSON の42桁で割る（58mm＝384ドット・28桁）。全角・¥ は2桁、倍角は2倍の幅', () => {
    expect(printableDots(80)).toBe(576);
    expect(printableDots(58)).toBe(384);
    const g = gridOf(80);
    expect(g.cols).toBe(42);
    expect(g.cell * 42).toBe(576);
    expect(gridOf(58).cols).toBe(28);
    expect(cellsOf('A')).toBe(1);
    expect(cellsOf('あ')).toBe(2);
    expect(cellsOf('¥')).toBe(2);
    const pages = layoutRaster(
      {
        pages: [
          [
            { kind: 'text', align: 'center', segments: [{ text: 'AB', w: 2, h: 2, em: false }] },
            { kind: 'text', align: 'right', segments: [{ text: '¥1', w: 1, h: 1, em: false }] },
          ],
        ],
        drawer: false,
        empty: false,
      },
      80
    );
    expect(pages).toHaveLength(1);
    const [center, right] = pages[0].lines;
    const start = Math.floor((576 - g.cell * 4) / 2); // 半角2文字×横2倍＝4桁
    expect(center.chars.map((c) => c.x)).toEqual([start, start + g.cell * 2]);
    expect(center.height).toBe(g.char * 2 + 6);
    expect(right.chars.map((c) => Math.round(c.x))).toEqual([Math.round(576 - g.cell * 3), Math.round(576 - g.cell)]);
    expect(right.y).toBe(center.y + center.height);
  });

  it('幅を超える行は折り返し、長い紙は 450mm ごとに分ける', () => {
    const long = 'あ'.repeat(30); // 60桁 > 42桁
    const [page] = layoutRaster({ pages: [[{ kind: 'text', align: 'left', segments: [{ text: long, w: 1, h: 1, em: false }] }]], drawer: false, empty: false }, 80);
    expect(page.lines).toHaveLength(2);
    expect(page.lines[0].chars).toHaveLength(21);
    const many = Array.from({ length: 200 }, () => ({ kind: 'text' as const, align: 'left' as const, segments: [{ text: 'x', w: 1, h: 1, em: false }] }));
    const pages = layoutRaster({ pages: [many], drawer: false, empty: false }, 80);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.height <= MAX_PAGE_DOTS)).toBe(true);
    expect(pages.reduce((n, p) => n + p.lines.length, 0)).toBe(200);
  });

  it('JPEG の大きさを読み、1枚ずつ1ページの PDF にする（203dpi・xref の位置が正しい）', () => {
    const jpeg = fakeJpeg(576, 40);
    expect(jpegInfo(jpeg)).toEqual({ width: 576, height: 40, components: 3 });
    expect(jpegInfo(new Uint8Array([1, 2, 3]))).toBeNull();
    const pdf = imagePdf([jpeg, fakeJpeg(576, 80, 1)]);
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 204.09 14.17]'); // 576 ドット＝72mm
    expect(text).toContain('/ColorSpace /DeviceGray');
    expect(text).toContain('/Filter /DCTDecode');
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // xref の 1 番目（Catalog）の位置
    const firstOffset = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10}) 00000 n/.exec(text)?.[1]);
    expect(text.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj');
  });

  it('SII URL Print Agent の URL（siiprintagent://1.0/print、PDF は base64 を URL エンコード）', () => {
    const url = siiAgentUrl({ pdfBase64: 'AB+/==', paper: 80, drawer: true });
    expect(url.startsWith('siiprintagent://1.0/print?Format=pdf&Data=AB%2B%2F%3D%3D&')).toBe(true);
    expect(url).toContain('Drawer=yes');
    expect(url).toContain('PaperWidth=80');
    expect(url).toContain('FitToWidth=yes');
    expect(url).toContain('CutType=partial');
    expect(url).not.toContain('Callback'); // Safari のタブが毎回増えないように
    const drawerOnly = siiAgentUrl({ pdfBase64: 'AA==', paper: 58, drawer: true, drawerOnly: true });
    expect(drawerOnly).toContain('CutType=off');
    expect(drawerOnly).toContain('CutFeed=no');
    expect(toBase64(new Uint8Array([0xff, 0x00, 0x10]))).toBe('/wAQ');
  });

  it('この iPad の設定に「SII URL Print Agent」でつないだことを残せる', () => {
    const cfg = parseDirectPrintConfig(
      JSON.stringify({ printerIds: [], bluetooth: [{ printerId: 'p1', deviceId: SII_AGENT_DEVICE_ID, deviceName: 'SII URL Print Agent', maker: 'sii', via: 'agent' }] })
    );
    expect(cfg.bluetooth?.[0]).toMatchObject({ via: 'agent', maker: 'sii' });
  });

  it('RP-F10 は Safari（SII URL Print Agent）で使える。アプリでは準備中のまま', () => {
    expect(printerModelById('sii-rp-f10')).toMatchObject({ ready: false, agent: true });
    expect(AGENT_PRINTER_MODELS.map((m) => m.id)).toEqual(['sii-rp-f10', 'sii-mp-b20']);
    const action = read('app/app/pos/device-printer-actions.ts');
    expect(action).toContain('if (model && !(model.ready || (viaAgent && model.agent)))');
  });

  it('Safari では SII のフォーム、アプリでは今まで通り。印刷は Safari だけ SII URL Print Agent', () => {
    const panel = read('components/pos/device-printer-panel.tsx');
    expect(panel).toContain('<SiiAgentForm printers={printers} canAdd={canAdd} onSelected={onSelected} />');
    const route = read('app/api/print/direct/route.ts');
    expect(route).toContain("if (body.format === 'epos') {");
    const agent = read('components/printing/direct-print-agent.tsx');
    expect(agent).toContain("format: 'epos',");
    expect(agent).toContain("await done(job, 'printed');\n      agentOpenedAt = Date.now();");
  });
});
