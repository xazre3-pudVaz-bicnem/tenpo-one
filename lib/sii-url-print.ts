/**
 * SII（セイコー）の Bluetooth レシートプリンター（RP-F10 など）に、iPad の Safari から印刷する
 * （2026-10-14 Ronnie「MEAT CROWN 新横浜。Airレジの SII RP-F10 を Bluetooth で。アプリはまだ無いので Safari でも」）。
 *
 * Safari は Bluetooth を使えないので、SII の無料アプリ「SII URL Print Agent」（App Store）を通す：
 *   印刷データ（ePOS-Print XML。どの印刷にも入っている）→ iPad の画面で画像にする → PDF に包む →
 *   siiprintagent://1.0/print?Format=pdf&Data=…（base64）を開く → SII のアプリが Bluetooth でプリンターへ送る。
 * 仕様：SII URL Print Agent for Android and iOS アプリケーションプログラマーズガイド Rev.01
 *   （https://www.sii-ps.com/common/URLPRNAgent_Android_iOS_JA_01.pdf）
 *
 * ここは純粋な関数だけ（DOM・Next 非依存・テスト対象）。画像にするのは components/printing/sii-agent-client.ts。
 */
import { colsFor, dispWidth, type PaperWidth } from './receipt-layout';
import { eposCols } from './epos-print';

export const SII_AGENT_SCHEME = 'siiprintagent';
/** App Store の「SII URL Print Agent」 */
export const SII_AGENT_APP_STORE_URL = 'https://apps.apple.com/jp/app/sii-url-print-agent/id1502527506';
/** iPad の localStorage に入れる「つないだ機械」の目印（Bluetooth の機械そのものは SII のアプリが持つ） */
export const SII_AGENT_DEVICE_ID = 'sii-url-print-agent';

/** 1mm あたりのドット（203dpi） */
export const DOTS_PER_MM = 8;
/** 行と行のあいだ */
export const LINE_GAP_DOTS = 6;
/** 1枚の画像の高さの上限（SII のアプリは 1 回 500mm まで。余裕をみて 450mm） */
export const MAX_PAGE_DOTS = 450 * DOTS_PER_MM;

/** 印字できる幅（ドット）。80mm＝576ドット（72mm）、58mm＝384ドット（48mm） */
export function printableDots(paper: PaperWidth): number {
  return colsFor(paper) * 12;
}

/**
 * 文字の升目。印刷データ（ePOS-Print XML）は EPSON の桁数（80mm＝42桁・58mm＝28桁。lib/epos-print.ts の eposCols）で
 * 並べてあるので、その桁数で印字幅いっぱいに割る。文字の高さは幅の2倍（半角＝縦長）。
 */
export function gridOf(paper: PaperWidth): { cols: number; cell: number; char: number } {
  const cols = eposCols(paper);
  const cell = printableDots(paper) / cols;
  return { cols, cell, char: Math.round(cell * 2) };
}

export type Align = 'left' | 'center' | 'right';

export interface RasterSegment {
  text: string;
  /** 横倍率 1〜8 */
  w: number;
  /** 縦倍率 1〜8 */
  h: number;
  em: boolean;
}

export type RasterLine = { kind: 'text'; align: Align; segments: RasterSegment[] } | { kind: 'feed'; lines: number };

export interface RasterDoc {
  /** <cut> ごとに分けた紙（1枚目・2枚目…） */
  pages: RasterLine[][];
  /** ドロアを開く（<pulse>） */
  drawer: boolean;
  /** 文字が1つも無い（ドロアだけ） */
  empty: boolean;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-zA-Z_:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/**
 * ePOS-Print XML（lib/epos-print.ts が作るもの）を行に分ける。lib/escpos.ts と同じく、
 * <text align|width|height|em/> は「ここから先」の設定（プリンターと同じ）。
 */
export function parseEposForRaster(xml: string): RasterDoc {
  const pages: RasterLine[][] = [[]];
  let drawer = false;
  let empty = true;
  let align: Align = 'left';
  let w = 1;
  let h = 1;
  let em = false;
  type Current = { align: Align; segments: RasterSegment[] };
  let current = null as Current | null;

  const page = () => pages[pages.length - 1];
  const flush = (force: boolean) => {
    if (current && (current.segments.length > 0 || force)) page().push({ kind: 'text', align: current.align, segments: current.segments });
    else if (!current && force) page().push({ kind: 'text', align, segments: [] });
    current = null;
  };

  const re = /<(text|feed|cut|pulse)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of xml.matchAll(re)) {
    const tag = m[1];
    const a = attrs(m[2] ?? '');
    if (tag === 'text') {
      if (a.align === 'left' || a.align === 'center' || a.align === 'right') {
        align = a.align;
        // 行の途中で揃えが変わったら、プリンターと同じく次の行から
        if (current && current.segments.length === 0) current.align = align;
      }
      if (a.width) w = clampInt(Number(a.width), 1, 8);
      if (a.height) h = clampInt(Number(a.height), 1, 8);
      if (a.em) em = a.em === 'true';
      const content = m[3];
      if (content === undefined || content.length === 0) continue;
      const text = decodeEntities(content).replace(/\r\n?/g, '\n');
      const parts = text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) flush(true);
        if (part.length > 0) {
          if (!current) current = { align, segments: [] };
          current.segments.push({ text: part, w, h, em });
          if (part.trim().length > 0) empty = false;
        }
      });
    } else if (tag === 'feed') {
      flush(false);
      const n = clampInt(Number(a.line ?? 1), 0, 255);
      if (n > 0) page().push({ kind: 'feed', lines: n });
    } else if (tag === 'cut') {
      flush(false);
      pages.push([]);
    } else if (tag === 'pulse') {
      drawer = true;
    }
  }
  flush(false);
  // 最後の空の紙（<cut> のあと何も無い）は捨てる
  while (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  // 紙の終わりの送り（カットの前の <feed line="3"/>）は SII のアプリの送りに任せる
  for (const p of pages) while (p.length > 0 && p[p.length - 1].kind === 'feed') p.pop();
  return { pages, drawer, empty };
}

/** 1文字の幅（半角の桁）。EPSON 用のデータなので「¥」は全角（lib/epos-print.ts と同じ前提） */
export function cellsOf(ch: string): number {
  return Math.max(1, Math.round(dispWidth(ch, { yenFullWidth: true })));
}

export interface PlacedChar {
  ch: string;
  /** 左上からの位置（ドット） */
  x: number;
  /** この文字の箱の幅（ドット） */
  width: number;
  w: number;
  h: number;
  em: boolean;
}

export interface PlacedLine {
  /** 行の上端（ドット） */
  y: number;
  /** 行の高さ（文字＋行間） */
  height: number;
  chars: PlacedChar[];
}

export interface PlacedPage {
  width: number;
  height: number;
  /** 文字の高さ（倍率1） */
  char: number;
  lines: PlacedLine[];
}

/** 上下の余白（ドット） */
const PAD_TOP = 8;
const PAD_BOTTOM = 16;

/**
 * 行を紙の上に並べる（どの文字をどこに描くか）。幅を超える行は折り返す。
 * 1枚が長すぎる（MAX_PAGE_DOTS を超える）ときは行の区切りで次の紙に分ける。
 */
export function layoutRaster(doc: RasterDoc, paper: PaperWidth): PlacedPage[] {
  const width = printableDots(paper);
  const { cell, char } = gridOf(paper);
  const out: PlacedPage[] = [];

  for (const lines of doc.pages) {
    let page: PlacedPage = { width, height: PAD_TOP, char, lines: [] };
    const push = (line: Omit<PlacedLine, 'y'>) => {
      if (page.height + line.height + PAD_BOTTOM > MAX_PAGE_DOTS && page.lines.length > 0) {
        page.height += PAD_BOTTOM;
        out.push(page);
        page = { width, height: PAD_TOP, char, lines: [] };
      }
      page.lines.push({ ...line, y: page.height });
      page.height += line.height;
    };

    for (const line of lines) {
      if (line.kind === 'feed') {
        for (let i = 0; i < line.lines; i++) push({ height: char + LINE_GAP_DOTS, chars: [] });
        continue;
      }
      // 折り返し：幅に入るところまで
      const rows: { chars: Omit<PlacedChar, 'x'>[]; used: number; maxH: number }[] = [{ chars: [], used: 0, maxH: 1 }];
      for (const seg of line.segments) {
        for (const ch of seg.text) {
          const cw = cellsOf(ch) * cell * seg.w;
          let row = rows[rows.length - 1];
          if (row.used + cw > width + 0.01 && row.chars.length > 0) {
            row = { chars: [], used: 0, maxH: 1 };
            rows.push(row);
          }
          row.chars.push({ ch, width: cw, w: seg.w, h: seg.h, em: seg.em });
          row.used += cw;
          row.maxH = Math.max(row.maxH, seg.h);
        }
      }
      for (const row of rows) {
        // 行末の空白は揃えの計算に入れない（プリンターと同じく、右揃え・中央揃えがずれない）
        let used = row.used;
        for (let i = row.chars.length - 1; i >= 0 && row.chars[i].ch === ' '; i--) used -= row.chars[i].width;
        const start = line.align === 'center' ? Math.max(0, Math.floor((width - used) / 2)) : line.align === 'right' ? Math.max(0, width - used) : 0;
        let x = start;
        const chars: PlacedChar[] = row.chars.map((c) => {
          const placed = { ...c, x };
          x += c.width;
          return placed;
        });
        push({ height: char * row.maxH + LINE_GAP_DOTS, chars });
      }
    }
    page.height += PAD_BOTTOM;
    out.push(page);
  }
  return out;
}

/** JPEG の大きさと色の数（SOF を読む）。読めなければ null */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0〜SOF15（DHT・JPG・DAC を除く）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      return { width, height, components };
    }
    i += 2 + len;
  }
  return null;
}

const ascii = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** 点（ドット）→ PDF の大きさ（pt） */
const dotsToPt = (dots: number) => Math.round(((dots / DOTS_PER_MM) * 72) / 25.4 * 100) / 100;

/**
 * JPEG の画像を1枚ずつ1ページにした PDF を作る（ページの大きさ＝画像の大きさ。203dpi）。
 */
export function imagePdf(pages: Uint8Array[]): Uint8Array {
  if (pages.length === 0) throw new Error('ページがありません');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number) => {
    offsets[n] = length;
  };

  write('%PDF-1.4\n%âãÏÓ\n');
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1);
  write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2);
  write(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((jpeg, i) => {
    const info = jpegInfo(jpeg);
    if (!info) throw new Error('JPEG を読めません');
    const pageId = 3 + i * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const wPt = dotsToPt(info.width);
    const hPt = dotsToPt(info.height);
    const colorSpace = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    obj(pageId);
    write(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
    obj(imageId);
    write(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
        `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    write(jpeg);
    write('\nendstream\nendobj\n');
    const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    obj(contentId);
    write(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const count = 3 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  write(xref);
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** base64（ブラウザ・サーバー両方で使える） */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/**
 * SII URL Print Agent を開く URL。
 *   Drawer … ドロアを開く。ドロアだけ（文字なし）のときは切らない・送らない
 *   FitToWidth … 紙の幅に合わせる（画像は印字幅ぴったりに作っている）
 *   SelectOnError … つながらないとき、SII のアプリでプリンターを選び直せる
 *   成功・失敗のときに Safari へ戻る URL（Callback）は付けない（付けると Safari のタブが毎回増える）
 */
export function siiAgentUrl(input: { pdfBase64: string; paper: PaperWidth; drawer: boolean; drawerOnly?: boolean }): string {
  const q: [string, string][] = [
    ['Format', 'pdf'],
    ['Data', input.pdfBase64],
    ['BtKeepConnect', 'always'],
    ['ErrorDialog', 'yes'],
    ['SelectOnError', 'yes'],
    ['Timeout', '30000'],
    ['Drawer', input.drawer ? 'yes' : 'no'],
    ['CutType', input.drawerOnly ? 'off' : 'partial'],
    ['CutFeed', input.drawerOnly ? 'no' : 'yes'],
    ['PaperWidth', String(input.paper)],
    ['FitToWidth', 'yes'],
  ];
  return `${SII_AGENT_SCHEME}://1.0/print?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
