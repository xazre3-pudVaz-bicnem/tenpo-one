import sharp, { type OverlayOptions } from 'sharp';
import path from 'node:path';
import type { TicketDesign } from './ticket-design';
import type { KitchenTicketBuzzer } from './kitchen-ticket';
import { buzzerStarPrnt } from './starprnt';
import { buzzerMarkup } from './receipt-markup';

// Use the bundled Fontconfig fonts on macOS as well as Linux (CoreText ignores fontfile).
process.env.PANGOCAIRO_BACKEND ??= 'fc';
process.env.FONTCONFIG_FILE ??= path.join(process.cwd(), 'public/fonts/fonts.conf');
const fonts = (name: string) => path.join(process.cwd(), 'public/fonts', name);
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let ready: Promise<void> | undefined;
function loadFonts() {
  return ready ??= (async () => {
    for (const name of ['Tinos-Regular.ttf', 'Tinos-Bold.ttf', 'NotoSerifCJKjp-Regular.otf', 'NotoSansCJKjp-Regular.otf']) {
      await sharp({ text: { text: '字A', fontfile: fonts(name), font: 'sans 12', rgba: true } }).png().toBuffer();
    }
  })();
}
/** Natural letter proportions, measured wrapping, no clipping of long names/reasons. */
export async function renderTicketImage(design: TicketDesign, width: 384 | 576 = 576, upsideDown = false): Promise<Buffer> {
  await loadFonts();
  const layers: OverlayOptions[] = [];
  const margin = 12, available = width - margin * 2;
  let y = 14;
  for (const row of design.rows) {
    y += row.gap ?? 0;
    const pad = row.black ? 12 : 6;
    const indent = row.indent ?? 0;
    const shares = row.cells.reduce((sum, c) => sum + (c.share ?? 1), 0);
    let x = margin + indent + (row.black ? 8 : 0);
    const contentWidth = available - indent - (row.black ? 16 : 0);
    const images: { image: Buffer; x: number; height: number }[] = [];
    let h = 0;
    for (const c of row.cells) {
      const w = Math.floor(contentWidth * (c.share ?? 1) / shares);
      if (c.text) {
        const bold = c.bold ?? row.bold;
        const family = design.serif ? 'Tinos' : 'Noto Sans CJK JP';
        const size = c.size ?? row.size;
        const content = design.serif ? escape(c.text).replace(/([^\u0000-\u007f]+)/g, '<span font_family="Noto Serif CJK JP">$1</span>') : escape(c.text);
        const markup = `<span foreground="${row.black ? '#ffffff' : '#000000'}">${bold ? '<b>' : ''}${content}${bold ? '</b>' : ''}</span>`;
        const image = await sharp({ text: { text: markup, font: `${family} ${size}`, fontfile: fonts(design.serif ? (bold ? 'Tinos-Bold.ttf' : 'Tinos-Regular.ttf') : 'NotoSansCJKjp-Regular.otf'), width: Math.max(1, w - 8), wrap: 'word-char', align: c.align ?? 'left', rgba: true, dpi: 72, spacing: 4 } }).png().toBuffer();
        const meta = await sharp(image).metadata();
        const offset = c.align === 'right' ? w - 8 - meta.width! : c.align === 'center' ? Math.floor((w - 8 - meta.width!) / 2) : 0;
        images.push({ image, x: x + offset, height: meta.height! }); h = Math.max(h, meta.height!);
      }
      x += w;
    }
    if (row.black) layers.push({ input: { create: { width: available, height: h + pad * 2, channels: 4, background: '#000' } }, left: margin, top: y });
    for (const img of images) layers.push({ input: img.image, left: img.x, top: y + pad + Math.floor((h - img.height) / 2) });
    y += h + pad * 2;
    if (row.rule) {
      // Integer-aligned black pixels survive monochrome thresholding on thermal printers.
      const svg = `<svg width="${available}" height="2"><path d="M0 1H${available}" stroke="#000" stroke-width="2" ${row.rule === 'dotted' ? 'stroke-dasharray="2 4"' : ''}/></svg>`;
      layers.push({ input: Buffer.from(svg), left: margin, top: y }); y += 6;
    }
  }
  const png = await sharp({ create: { width, height: y + 18, channels: 3, background: '#fff' } }).composite(layers).png().toBuffer();
  return upsideDown ? sharp(png).rotate(180).png().toBuffer() : png;
}

/** Same monochrome pixels for StarPRNT, CloudPRNT markup and EPSON/iPad ESC/POS. */
export async function ticketImagePayload(images: Buffer[], buzzer?: KitchenTicketBuzzer) {
  const star: Buffer[] = []; const xml: string[] = []; const markup: string[] = [];
  for (const png of images) {
    const { data, info } = await sharp(png).flatten({ background: '#fff' }).greyscale().threshold(170).raw().toBuffer({ resolveWithObject: true });
    const rowBytes = Math.ceil(info.width / 8);
    star.push(Buffer.from([27, 64]));
    // Bounded blocks work with long orders and printers with small image buffers.
    for (let top = 0; top < info.height; top += 256) {
      const height = Math.min(256, info.height - top), bits = Buffer.alloc(rowBytes * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < info.width; x++) if (data[(top + y) * info.width + x] < 128) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      star.push(Buffer.from([27, 29, 83, 1, rowBytes & 255, rowBytes >> 8, height & 255, height >> 8, 0]), bits);
      xml.push(`<image width="${info.width}" height="${height}" color="color_1" mode="mono">${bits.toString('base64')}</image>`);
    }
    star.push(Buffer.from([27, 100, 3])); xml.push('<cut type="feed"/>');
    const mono = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
    markup.push(`[image: url "data:image/png;base64,${mono.toString('base64')}"; width ${info.width}]\n[cut: feed; partial]\n`);
  }
  star.push(buzzerStarPrnt(buzzer)); markup.push(buzzerMarkup(buzzer));
  if (buzzer === 'drawer1' || buzzer === 'drawer2') xml.push(`<pulse drawer="${buzzer === 'drawer1' ? 'drawer_1' : 'drawer_2'}" time="pulse_100"/>`);
  return { starprnt: Buffer.concat(star).toString('base64'), body: markup.join(''), epos: `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${xml.join('')}</epos-print>` };
}
