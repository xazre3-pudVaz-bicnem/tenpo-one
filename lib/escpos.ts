import iconv from 'iconv-lite';

/**
 * ePOS-Print XML（lib/epos-print.ts が作るもの）→ ESC/POS のバイト列。
 * iPad と Bluetooth でつないだ EPSON のレシートプリンターへ、アプリ（ePOS SDK の addCommand）から送るため
 * （2026-10-13 Ronnie「レシートプリンター＋ドロアは iPad と Bluetooth。チケットプリンターは LAN・Wi-Fi」）。
 *
 * 使っている要素だけを変換する（lib/epos-print.ts の冒頭の一覧と同じ）:
 *   <text lang="ja"/> <text align/> <text width height/> <text em/> <text rotate/> <text>文字</text> / <feed line/> / <cut/> / <pulse drawer/>
 * 文字は Shift_JIS（漢字モード）。「¥」は EPSON の桁合わせ（全角幅）に合わせて全角の「￥」で出す。
 */

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

const INIT = [ESC, 0x40];
/** 漢字モード ON・Shift_JIS・カタカナのコード表 */
const JAPANESE = [FS, 0x26, FS, 0x43, 0x01, ESC, 0x74, 0x01];
/** 紙を送って切る（パーシャルカット） */
const CUT = [GS, 0x56, 0x42, 0x00];

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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** ePOS-Print XML を ESC/POS に */
export function eposXmlToEscPos(xml: string): Buffer {
  const out: Buffer[] = [Buffer.from(INIT)];
  const push = (bytes: number[]) => out.push(Buffer.from(bytes));
  const re = /<(text|feed|cut|pulse|image)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of xml.matchAll(re)) {
    const tag = m[1];
    const a = attrs(m[2] ?? '');
    const content = m[3];
    if (tag === 'image') {
      const width = Number(a.width), height = Number(a.height);
      if (!Number.isInteger(width) || width < 1 || width > 576 || !Number.isInteger(height) || height < 1 || height > 8192) {
        throw new Error('印刷画像のサイズが不正です');
      }
      const bytes = Math.ceil(width / 8);
      const image = Buffer.from(content ?? '', 'base64');
      if (image.length !== bytes * height) throw new Error('印刷画像のデータ長が不正です');
      push([GS, 0x76, 0x30, 0, bytes & 255, bytes >> 8, height & 255, height >> 8]);
      out.push(image);
    } else if (tag === 'text') {
      if (a.lang === 'ja') push(JAPANESE);
      if (a.align) push([ESC, 0x61, a.align === 'center' ? 1 : a.align === 'right' ? 2 : 0]);
      if (a.width || a.height) {
        const w = clamp(Number(a.width ?? 1), 1, 8);
        const h = clamp(Number(a.height ?? 1), 1, 8);
        push([GS, 0x21, ((w - 1) << 4) | (h - 1)]);
      }
      if (a.em) push([ESC, 0x45, a.em === 'true' ? 1 : 0]);
      // 倒立印字（上下さかさまに付けたプリンター）。ESC { n
      if (a.rotate) push([ESC, 0x7b, a.rotate === 'true' ? 1 : 0]);
      if (content !== undefined && content.length > 0) {
        const text = decodeEntities(content).replace(/¥/g, '￥').replace(/\r\n?/g, '\n');
        out.push(iconv.encode(text, 'Shift_JIS'));
      }
    } else if (tag === 'feed') {
      push([ESC, 0x64, clamp(Number(a.line ?? 1), 0, 255)]);
    } else if (tag === 'cut') {
      push(CUT);
    } else if (tag === 'pulse') {
      // ESC p m t1 t2（2ms 単位）。pulse_100 → 100ms
      const ms = Number(/pulse_(\d+)/.exec(a.time ?? '')?.[1] ?? 100);
      push([ESC, 0x70, a.drawer === 'drawer_2' ? 1 : 0, clamp(ms / 2, 1, 255), clamp((ms * 5) / 2, 1, 255)]);
    }
  }
  return Buffer.concat(out);
}
