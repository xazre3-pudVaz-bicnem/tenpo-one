import sharp, { type OverlayOptions } from 'sharp';
import path from 'node:path';
import { classicInvoiceLayout, type ClassicInvoiceOptions } from './classic-invoice';
import type { ReceiptData } from './receipts';

// Serverless containers need a writable fontconfig cache and bundled Japanese font.
process.env.FONTCONFIG_FILE ??= path.join(process.cwd(), 'public/fonts/fonts.conf');
const fontfile = path.join(process.cwd(), 'public/fonts/NotoSansCJKjp-Regular.otf');
const escapeMarkup = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Image-based invoice only: short side crosses the roll, turn the paper to read. */
export async function renderClassicInvoice(receipt: ReceiptData, options: ClassicInvoiceOptions = {}, paperWidth: 58 | 80 = 80) {
  const layout = classicInvoiceLayout(receipt, options);
  const layers: OverlayOptions[] = [];
  for (const item of layout.items) {
    if (item.kind === 'text') {
      if (!item.text) continue;
      let image = await sharp({ text: {
        text: item.bold ? `<b>${escapeMarkup(item.text)}</b>` : escapeMarkup(item.text),
        font: `Noto Sans CJK JP ${item.size}`, fontfile, rgba: true, dpi: 72,
      } }).png().toBuffer();
      let meta = await sharp(image).metadata();
      if ((meta.width ?? 0) > item.width) {
        image = await sharp(image).resize({ width: item.width }).png().toBuffer();
        meta = await sharp(image).metadata();
      }
      const x = item.align === 'right' ? item.x - meta.width! : item.align === 'center' ? item.x - Math.round(meta.width! / 2) : item.x;
      layers.push({ input: image, left: Math.max(0, x), top: item.y });
    } else {
      const h = item.kind === 'line' ? 1 : item.height;
      const svg = item.kind === 'line'
        ? `<svg width="${item.width}" height="1"><path d="M0 .5H${item.width}" stroke="#555"/></svg>`
        : `<svg width="${item.width}" height="${h}"><rect x=".5" y=".5" width="${item.width - 1}" height="${h - 1}" fill="none" stroke="#888" stroke-dasharray="4 4"/></svg>`;
      layers.push({ input: Buffer.from(svg), left: item.x, top: item.y });
    }
  }
  const landscape = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: '#fff' } })
    .composite(layers).png().toBuffer();
  // Keep physical stamp dimensions proportional to roll width, do not crop text.
  const printWidth = paperWidth === 58 ? 384 : 576;
  const rotated = await sharp(landscape).rotate(90).png().toBuffer();
  const { data, info } = await sharp(rotated).resize({ width: printWidth }).flatten({ background: '#fff' })
    .greyscale().threshold(170).raw().toBuffer({ resolveWithObject: true });
  const rowBytes = Math.ceil(info.width / 8);
  const bits = Buffer.alloc(rowBytes * info.height);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] < 128) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  // StarPRNT specification: ESC GS S, monochrome block, horizontal BYTE count.
  const starprnt = Buffer.concat([Buffer.from([0x1b, 0x40, 0x1b, 0x1d, 0x53, 1, rowBytes & 255, rowBytes >> 8,
    info.height & 255, info.height >> 8, 0]), bits, Buffer.from([0x1b, 0x64, 3])]);
  const epos = `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><image width="${info.width}" height="${info.height}" color="color_1" mode="mono">${bits.toString('base64')}</image><cut type="feed"/></epos-print>`;
  const markup = `[image: url "data:image/png;base64,${png.toString('base64')}"; width ${info.width}]\n[cut: feed; partial]\n`;
  return { starprnt, epos, markup, landscape };
}
